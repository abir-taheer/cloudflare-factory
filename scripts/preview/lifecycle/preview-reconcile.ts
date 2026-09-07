import { Effect } from "effect";
import { PreviewFailure } from "../preview-model.ts";
import type { PreviewOwner } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";
import { previewGithubRequest } from "../preview-github.ts";
import { cleanupPreviewEnvironment, previewCleanupRetryPolicy } from "./preview-cleanup.ts";

/** Reconcile all manifests, including failed creates; expiry never closes a pull request. */
export const reconcilePreviewEnvironments = (
  repository: string,
  owner: PreviewOwner,
  credentials: PreviewCredentials,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const manifests = yield* state.list(owner);
    const failures: number[] = [];

    const recordFailure = () =>
      Effect.sync(() => {
        failures.push(1);
      });

    for (const manifest of manifests.filter((item) => item.status !== "deleted")) {
      yield* Effect.gen(function* () {
        const pull = yield* previewGithubRequest(`/repos/${repository}/pulls/${manifest.owner.pr}`);

        if (pull["state"] !== "open" && pull["state"] !== "closed") {
          return yield* Effect.fail(new PreviewFailure({ operation: "Preview PR state unknown" }));
        }

        if (
          pull["state"] === "closed" ||
          Date.parse(manifest.expiresAt) <= Date.now() ||
          manifest.status === "deleting"
        ) {
          yield* cleanupPreviewEnvironment(manifest, credentials, cf, state).pipe(
            Effect.retry(previewCleanupRetryPolicy),
          );
        }

        return yield* Effect.void;
      }).pipe(Effect.catchTag("PreviewFailure", recordFailure));
    }

    if (failures.length > 0) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview reconciliation incomplete; manifests retained" }),
      );
    }

    return yield* Effect.void;
  });
