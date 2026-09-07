import { Effect } from "effect";
import { z } from "zod";
import { PreviewFailure, previewResource } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewCloudflare } from "../cloudflare/preview-cloudflare.ts";

const CanonicalQueueConsumerSchema = z.object({
  consumer_id: z.string().regex(/^[a-f0-9]{32}$/u),
  type: z.literal("worker"),
  script_name: z.string().min(1),
  queue_name: z.string().optional(),
  queue_id: z.string().optional(),
});

// The live queue API uses `script`; the documented response uses `script_name`.
const QueueConsumerSchema = CanonicalQueueConsumerSchema.extend({
  script_name: CanonicalQueueConsumerSchema.shape.script_name.optional(),
  script: CanonicalQueueConsumerSchema.shape.script_name.optional(),
})
  .refine(
    (consumer) =>
      consumer.script === undefined ||
      consumer.script_name === undefined ||
      consumer.script === consumer.script_name,
  )
  .transform(({ script, script_name, ...consumer }) => ({
    ...consumer,
    script_name: script_name ?? script,
  }))
  .pipe(CanonicalQueueConsumerSchema);

/** Detach only the manifest-owned queue/Worker relationship; data stays until compute is absent. */
export const detachPreviewQueueConsumer = (manifest: PreviewManifest, cf: PreviewCloudflare) =>
  Effect.gen(function* () {
    const queue = previewResource(manifest, "jobs");
    const queueId = yield* cf.lookupResource(queue);

    if (queueId === null) {
      return yield* Effect.void;
    }

    const queueDrift =
      queue.phase === "planned" || queue.phase === "deleted" || queue.id !== queueId;

    if (queueDrift) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview queue ownership drift" }));
    }

    const path = `/queues/${encodeURIComponent(queueId)}/consumers`;

    const consumers = z
      .array(QueueConsumerSchema)
      .max(1)
      .safeParse(yield* cf.list(path));

    if (!consumers.success) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview queue consumer inventory invalid" }),
      );
    }

    const consumer = consumers.data[0];

    if (consumer === undefined) {
      return yield* Effect.void;
    }

    const worker = previewResource(manifest, "workflows");
    const workerId = yield* cf.lookupResource(worker);

    const consumerDrift =
      worker.phase !== "ready" ||
      worker.id === null ||
      worker.id !== workerId ||
      consumer.script_name !== worker.name ||
      (consumer.queue_id !== undefined && consumer.queue_id !== queueId) ||
      (consumer.queue_name !== undefined && consumer.queue_name !== queue.name);

    if (consumerDrift) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview queue consumer ownership mismatch" }),
      );
    }

    yield* cf.request(`${path}/${encodeURIComponent(consumer.consumer_id)}`, "DELETE");

    const remaining = yield* cf.list(path);

    if (remaining.length > 0) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview queue consumer removal pending" }),
      );
    }

    return yield* Effect.void;
  });
