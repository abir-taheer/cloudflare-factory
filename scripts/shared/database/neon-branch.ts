import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewString } from "../../preview/preview-model.ts";
import { verifyNeonEmptyBaseline } from "./neon-baseline.ts";
import { waitNeonDatabaseOperations } from "./neon-api.ts";
import type { NeonDatabaseApi, NeonDatabaseCredentials } from "./neon-api.ts";
import type { DatabaseTarget } from "./database-adapter.ts";

/** Persisted ownership fields are repeated as provider annotations before branch creation. */
export function neonOwnerAnnotations(target: DatabaseTarget) {
  return {
    account: target.owner.accountId,
    repository: target.owner.repositoryId,
    environment: target.owner.environment,
    pr: String(target.owner.pr),
    intent: target.identity.intentId,
    parent: target.identity.parentBranchId,
  };
}

/** Create only a schema fork of the independently pinned empty baseline. */
export function createNeonEmptyBranch(
  credentials: NeonDatabaseCredentials,
  api: NeonDatabaseApi,
  target: DatabaseTarget,
) {
  return Effect.gen(function* () {
    yield* verifyNeonEmptyBaseline(credentials, api);

    let result = yield* api.request("/branches", "POST", {
      branch: {
        name: target.name,
        parent_id: credentials.parentBranchId,
        init_source: "parent-schema",
      },
      endpoints: [
        {
          type: "read_write",
          autoscaling_limit_min_cu: 0.25,
          autoscaling_limit_max_cu: 0.25,
          suspend_timeout_seconds: 0,
        },
      ],
      annotation_value: neonOwnerAnnotations(target),
    });

    if (result === null) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon branch create unavailable" }),
      );
    }

    yield* waitNeonDatabaseOperations(api, result);

    // Create responses may omit annotations; read the same immutable ID before trusting it.
    result = yield* api.request(
      `/branches/${encodeURIComponent(previewString(previewRecord(result["branch"])["id"]))}`,
    );

    return result;
  });
}
