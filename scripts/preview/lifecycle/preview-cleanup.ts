import { detachPreviewQueueConsumer } from "./preview-queue-consumer-cleanup.ts";
import { cleanupPreviewDomains } from "../domains/preview-domain-cleanup.ts";
import { Effect, Schedule } from "effect";
import { PreviewFailure, previewResource } from "../preview-model.ts";
import type { PreviewManifest, PreviewResource } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";

/** Control-plane deletion readbacks may lag; callers retain the lifecycle lock during retries. */
export const previewCleanupRetryPolicy = { times: 20, schedule: Schedule.spaced("3 seconds") };

/** A missing manifest or a name/ID mismatch never authorizes deleting a resource. */
export const deletePreviewResource = (
  manifest: PreviewManifest,
  resource: PreviewResource,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const live = yield* cf.lookupResource(resource);

    if (live === null) {
      resource.phase = "deleted";
      yield* state.save(manifest);
      return yield* Effect.void;
    }

    if (
      resource.phase === "planned" ||
      resource.phase === "deleted" ||
      (resource.id !== null && resource.id !== live)
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview deletion ownership mismatch" }),
      );
    }

    if (resource.kind === "do") {
      return yield* Effect.fail(
        new PreviewFailure({
          operation: "Preview Durable Object namespace remains after Worker deletion",
        }),
      );
    }

    if (resource.kind === "r2") {
      yield* state.emptyBucket(manifest, resource.name);
    }

    yield* cf.remove(resource, live);

    if ((yield* cf.lookupResource(resource)) !== null) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview deletion readback failed" }),
      );
    }

    resource.phase = "deleted";
    yield* state.save(manifest);
    return yield* Effect.void;
  });

/** Remove ingress and writers before storage; keep the manifest until every absence check passes. */
export const cleanupPreviewEnvironment = (
  manifest: PreviewManifest,
  credentials: PreviewCredentials,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    if (manifest.status === "deleted") {
      return yield* Effect.void;
    }

    manifest.status = "deleting";
    yield* state.save(manifest);

    yield* cleanupPreviewDomains(manifest, credentials, cf, state);

    // Disable legacy workers.dev ingress before deleting compute.
    for (const suffix of ["frontend", "api"]) {
      const worker = previewResource(manifest, suffix);
      const workerId = yield* cf.lookupResource(worker);

      if (workerId !== null) {
        if (
          worker.phase === "planned" ||
          worker.phase === "deleted" ||
          (worker.id !== null && worker.id !== workerId)
        ) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview ingress ownership mismatch" }),
          );
        }

        yield* cf.request(`/workers/scripts/${encodeURIComponent(worker.name)}/subdomain`, "POST", {
          enabled: false,
          previews_enabled: false,
        });
      }
    }

    const workerNames = new Set(
      manifest.resources
        .filter((resource) => resource.kind === "worker")
        .map((resource) => resource.name),
    );

    const domainInventory = yield* cf.list("/workers/domains");

    const unknownAttachment = domainInventory.some(
      (domain) => typeof domain["service"] !== "string" || workerNames.has(domain["service"]),
    );

    if (unknownAttachment) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview Worker still has unowned domain attachments" }),
      );
    }

    yield* detachPreviewQueueConsumer(manifest, cf);

    const failures: string[] = [];

    const attempt = (resource: PreviewResource) =>
      deletePreviewResource(manifest, resource, cf, state).pipe(
        Effect.catchTag("PreviewFailure", () =>
          Effect.sync(() => {
            failures.push(resource.kind);
          }),
        ),
      );

    for (const suffix of ["frontend", "api", "workflow", "workflows"]) {
      yield* attempt(previewResource(manifest, suffix));
    }

    for (const resource of manifest.resources.filter(
      (item) => item.kind === "container" || item.kind === "do",
    )) {
      yield* attempt(resource);
    }

    // Do not empty data while any Worker/Workflow/container could still write it.
    if (failures.length > 0) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview compute cleanup incomplete; state retained" }),
      );
    }

    for (const resource of manifest.resources.filter((item) =>
      ["queue", "r2", "kv", "hyperdrive"].includes(item.kind),
    )) {
      yield* attempt(resource);
    }

    if (failures.length > 0) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview data cleanup incomplete; state retained" }),
      );
    }

    manifest.status = manifest.resources.every((resource) => resource.phase === "deleted")
      ? "deleted"
      : "deleting";

    yield* state.save(manifest);

    process.stdout.write(
      `Preview Cloudflare resources absent; database cleanup action required for PR #${manifest.owner.pr}\n`,
    );

    return yield* Effect.void;
  });
