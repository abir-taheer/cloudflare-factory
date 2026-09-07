import { Effect } from "effect";
import { PreviewFailure, previewResource } from "./preview-model.ts";
import type { PreviewManifest, PreviewResource } from "./preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "./preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";
import { previewDatabaseRequest } from "./preview-options.ts";

/** A missing manifest or a name/ID mismatch never authorizes deleting a resource. */
export const deletePreviewResource = (
  manifest: PreviewManifest, resource: PreviewResource, cf: PreviewCloudflare, state: PreviewStateStore,
) => Effect.gen(function* () {
  const live = yield* cf.lookupResource(resource);
  if (live === null) { resource.phase = "deleted"; yield* state.save(manifest); return yield* Effect.void; }
  if (resource.phase === "planned" || resource.phase === "deleted" || (resource.id !== null && resource.id !== live)) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview deletion ownership mismatch" }));
  }
  if (resource.kind === "do") return yield* Effect.fail(new PreviewFailure({ operation: "Preview Durable Object namespace remains after Worker deletion" }));
  if (resource.kind === "r2") yield* state.emptyBucket(manifest, resource.name);
  yield* cf.remove(resource, live);
  if ((yield* cf.lookupResource(resource)) !== null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview deletion readback failed" }));
  resource.phase = "deleted";
  yield* state.save(manifest);
  return yield* Effect.void;
});

/** Remove ingress and writers before storage; keep the manifest until every absence check passes. */
export const cleanupPreviewEnvironment = (
  manifest: PreviewManifest, credentials: PreviewCredentials, cf: PreviewCloudflare, state: PreviewStateStore,
) => Effect.gen(function* () {
  if (manifest.status === "deleted") return yield* Effect.void;
  manifest.status = "deleting";
  yield* state.save(manifest);
  // Stop public reachability even if a later delete fails. No custom routes or DNS are created.
  const frontend = previewResource(manifest, "frontend");
  const frontendId = yield* cf.lookupResource(frontend);
  if (frontendId !== null) {
    if (frontend.phase === "planned" || frontend.phase === "deleted" || (frontend.id !== null && frontend.id !== frontendId)) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview ingress ownership mismatch" }));
    }
    yield* cf.request(`/workers/scripts/${encodeURIComponent(frontend.name)}/subdomain`, "POST", { enabled: false, previews_enabled: false });
  }
  const failures: string[] = [];
  const attempt = (resource: PreviewResource) => deletePreviewResource(manifest, resource, cf, state).pipe(
    Effect.catchTag("PreviewFailure", () => Effect.sync(() => { failures.push(resource.kind); })),
  );
  for (const suffix of ["frontend", "api", "workflow", "workflows"]) yield* attempt(previewResource(manifest, suffix));
  for (const resource of manifest.resources.filter((item) => item.kind === "container" || item.kind === "do")) yield* attempt(resource);
  // Do not empty data while any Worker/Workflow/container could still write it.
  if (failures.length > 0) return yield* Effect.fail(new PreviewFailure({ operation: "Preview compute cleanup incomplete; state retained" }));
  for (const resource of manifest.resources.filter((item) => ["queue", "r2", "kv", "d1", "hyperdrive"].includes(item.kind))) yield* attempt(resource);
  if (manifest.hyperdrive && previewResource(manifest, "hyperdrive").phase === "deleted") {
    const resource = previewResource(manifest, "postgres");
    yield* Effect.gen(function* () {
      const existing = yield* previewDatabaseRequest(credentials, manifest, "GET");
      if (existing !== null) {
        if (resource.phase === "planned" || resource.phase === "deleted") return yield* Effect.fail(new PreviewFailure({ operation: "Preview external database deletion denied" }));
        yield* previewDatabaseRequest(credentials, manifest, "DELETE");
      }
      if ((yield* previewDatabaseRequest(credentials, manifest, "GET")) !== null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview external database remains" }));
      resource.phase = "deleted";
      yield* state.save(manifest);
      return yield* Effect.void;
    }).pipe(Effect.catchTag("PreviewFailure", () => Effect.sync(() => { failures.push("database"); })));
  }
  if (failures.length > 0) return yield* Effect.fail(new PreviewFailure({ operation: "Preview data cleanup incomplete; state retained" }));
  manifest.status = "deleted";
  yield* state.save(manifest);
  process.stdout.write(`Preview resources verified absent for PR #${manifest.owner.pr}\n`);
  return yield* Effect.void;
});
