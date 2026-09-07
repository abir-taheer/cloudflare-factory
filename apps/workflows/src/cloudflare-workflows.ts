import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { MessageBatch } from "@cloudflare/workers-types";
import { Effect } from "effect";
import type { BackgroundJob } from "@factory/platform";
import { runNoteJob } from "@factory/platform/demo";
import {
  type CloudflarePlatformBindings,
  cloudflarePlatformLayer,
} from "@factory/platform/cloudflare";

/** Optional deployments bind this SDK class; exporting it does not provision a container. */
export { Sandbox } from "@cloudflare/sandbox";

/** Workflow steps contain replay-safe domain effects; no provider types enter the job program. */
export class DemoWorkflow extends WorkflowEntrypoint<CloudflarePlatformBindings, BackgroundJob> {
  override async run(event: WorkflowEvent<BackgroundJob>, step: WorkflowStep) {
    return step.do(
      "process-note",
      { retries: { limit: 5, delay: "2 seconds", backoff: "exponential" } },
      () =>
        Effect.runPromise(
          runNoteJob(event.payload).pipe(
            Effect.as({ id: event.payload.id }),
            Effect.provide(cloudflarePlatformLayer(this.env)),
          ),
        ),
    );
  }
}

export { JobCoordinator } from "./cloudflare-job-coordinator.js";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
  queue(batch: MessageBatch<BackgroundJob>, bindings: CloudflarePlatformBindings): Promise<void> {
    return Effect.runPromise(
      Effect.forEach(
        batch.messages,
        (message) =>
          Effect.tryPromise(() =>
            bindings.WORKFLOW.create({ id: message.body.id, params: message.body }),
          ).pipe(
            // A duplicate is accepted only after a successful durable read-back.
            Effect.matchEffect({
              onSuccess: Effect.succeed,
              onFailure: () =>
                Effect.gen(function* () {
                  const workflow = yield* Effect.tryPromise(() =>
                    bindings.WORKFLOW.get(message.body.id),
                  );

                  return yield* Effect.tryPromise(() => workflow.status());
                }),
            }),
            Effect.match({
              onFailure: () => {
                message.retry();
              },
              onSuccess: () => {
                message.ack();
              },
            }),
          ),
        { concurrency: 1, discard: true },
      ),
    );
  },
};
