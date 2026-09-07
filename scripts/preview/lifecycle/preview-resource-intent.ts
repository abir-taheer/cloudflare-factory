import { provisionPreviewHyperdrive } from "../cloudflare/preview-hyperdrive.ts";
import { Effect } from "effect";
import { PreviewFailure } from "../preview-model.ts";
import type { PreviewManifest, PreviewResource } from "../preview-model.ts";
import type { PreviewCloudflare } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";

/** Recover an uncertain create only when its write-ahead intent already owns the exact name. */
export const preparePreviewResource = (
  manifest: PreviewManifest,
  resource: PreviewResource,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const existing = yield* cf.lookupResource(resource);

    if (
      existing !== null &&
      (resource.phase === "planned" ||
        resource.phase === "deleted" ||
        (resource.id !== null && resource.id !== existing))
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview refuses unowned resource adoption" }),
      );
    }

    if (resource.id !== null && existing === null) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview resource drift requires cleanup" }),
      );
    }

    resource.phase = existing === null ? "creating" : "ready";
    resource.id = existing;
    yield* state.save(manifest);
    return existing;
  });

/** Provision and read back data resources after the database handoff is validated. */
export function provisionPreviewDataResources(
  manifest: PreviewManifest,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    yield* provisionPreviewHyperdrive(manifest, cf, state);

    for (const resource of manifest.resources.filter((item) =>
      ["kv", "r2", "queue"].includes(item.kind),
    )) {
      const existing = yield* preparePreviewResource(manifest, resource, cf, state);

      if (existing === null) {
        resource.id = yield* cf.create(resource);
      }

      resource.phase = "ready";
      yield* state.save(manifest);

      if ((yield* cf.lookupResource(resource)) !== resource.id) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview create readback failed" }),
        );
      }
    }

    return yield* Effect.void;
  });
}
