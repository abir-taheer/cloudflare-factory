import { createNeonEmptyBranch, neonOwnerAnnotations } from "./neon-branch.ts";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewString } from "../../preview/preview-model.ts";
import { parseDatabaseHandoff } from "./database-contract.ts";
import type { DatabaseIdentity } from "./database-schema.ts";
import {
  createNeonDatabaseApi,
  readNeonDirectConnection,
  waitNeonDatabaseOperations,
} from "./neon-api.ts";
import type { NeonDatabaseApi, NeonDatabaseCredentials } from "./neon-api.ts";
import type { DatabaseTarget, PreviewDatabaseAdapter } from "./database-adapter.ts";

const branchPollLimit = 60;

/** Random write-ahead intent is matched against provider annotations, not inferred from names. */
export const createNeonDatabaseIdentity = (
  credentials: NeonDatabaseCredentials,
): DatabaseIdentity => ({
  provider: "neon",
  projectId: credentials.projectId,
  parentBranchId: credentials.parentBranchId,
  intentId: randomUUID(),
  branchId: null,
  endpointId: null,
  hostname: null,
});

/** Immutable provider IDs and persisted intent must all agree before recovery or deletion. */
export function validateNeonOwnedBranch(
  result: Record<string, unknown>,
  target: DatabaseTarget,
  credentials: NeonDatabaseCredentials,
) {
  const branch = previewRecord(result["branch"]);
  const annotation = previewRecord(previewRecord(result["annotation"])["value"]);

  if (
    target.identity.provider !== "neon" ||
    target.identity.projectId !== credentials.projectId ||
    target.identity.parentBranchId !== credentials.parentBranchId ||
    branch["project_id"] !== credentials.projectId ||
    branch["parent_id"] !== credentials.parentBranchId ||
    branch["id"] === credentials.parentBranchId ||
    branch["name"] !== target.name ||
    branch["default"] !== false ||
    branch["protected"] !== false ||
    branch["init_source"] !== "parent-schema" ||
    (target.identity.branchId !== null && branch["id"] !== target.identity.branchId)
  ) {
    throw new Error("Neon branch ownership mismatch");
  }

  for (const [key, value] of Object.entries(neonOwnerAnnotations(target))) {
    if (annotation[key] !== value) {
      throw new Error("Neon branch intent mismatch");
    }
  }

  return previewString(branch["id"]);
}

const checkedBranch = (
  result: Record<string, unknown>,
  target: DatabaseTarget,
  credentials: NeonDatabaseCredentials,
) =>
  Effect.try({
    try: () => validateNeonOwnedBranch(result, target, credentials),
    catch: () =>
      new PreviewFailure({ operation: "Neon refuses foreign branch adoption or deletion" }),
  });

function waitNeonBranch(api: NeonDatabaseApi, branchId: string, absent: boolean) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < branchPollLimit; attempt += 1) {
      const result = yield* api.request(`/branches/${encodeURIComponent(branchId)}`);

      const branchAbsent = absent && result === null;

      const branchReady =
        !absent && result !== null && previewRecord(result["branch"])["current_state"] === "ready";

      if (branchAbsent || branchReady) {
        return result;
      }

      yield* Effect.sleep("2 seconds");
    }

    return yield* Effect.fail(
      new PreviewFailure({ operation: "Neon branch operation did not complete" }),
    );
  });
}

function createNeonProvisioner(
  credentials: NeonDatabaseCredentials,
  api: NeonDatabaseApi,
): PreviewDatabaseAdapter["provision"] {
  return (initial, save) =>
    Effect.gen(function* () {
      let target = initial;

      if (
        target.identity.provider !== "neon" ||
        target.identity.projectId !== credentials.projectId ||
        target.identity.parentBranchId !== credentials.parentBranchId
      ) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon persisted project or parent drift" }),
        );
      }

      let result = yield* api.branchByName(target.name);

      if (result === null && target.identity.branchId !== null) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon owned branch disappeared; cleanup required" }),
        );
      }

      result ??= yield* createNeonEmptyBranch(credentials, api, target);

      if (result === null) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon branch readback missing" }),
        );
      }

      const branchId = yield* checkedBranch(result, target, credentials);

      target = { ...target, identity: { ...target.identity, branchId } };
      yield* save(target.identity);

      const ready = yield* waitNeonBranch(api, branchId, false);

      if (ready === null) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon branch readiness missing" }),
        );
      }

      yield* checkedBranch(ready, target, credentials);

      const endpointResult = yield* api.request(`/branches/${branchId}/endpoints`);
      const endpoints = endpointResult?.["endpoints"];

      if (!Array.isArray(endpoints)) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon branch endpoint missing" }),
        );
      }

      const writers = endpoints
        .map((value: unknown) => previewRecord(value))
        .filter((endpoint) => endpoint["type"] === "read_write");

      if (writers.length !== 1) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon branch writer ambiguous" }),
        );
      }

      const endpoint = previewRecord(writers[0]);
      const endpointId = previewString(endpoint["id"]);
      const hostname = previewString(endpoint["host"]);

      if (
        endpoint["branch_id"] !== branchId ||
        endpoint["project_id"] !== credentials.projectId ||
        (target.identity.endpointId !== null &&
          (target.identity.endpointId !== endpointId || target.identity.hostname !== hostname))
      ) {
        return yield* Effect.fail(new PreviewFailure({ operation: "Neon branch endpoint drift" }));
      }

      if (target.identity.endpointId === null) {
        // Branches inherit role passwords; rotate before exposing the new branch to any Worker.
        const reset = yield* api.request(
          `/branches/${branchId}/roles/${encodeURIComponent(credentials.roleName)}/reset_password`,
          "POST",
        );

        yield* waitNeonDatabaseOperations(api, reset);
      }

      const directUrl = yield* readNeonDirectConnection(credentials, api, branchId, endpointId);
      target = { ...target, identity: { ...target.identity, endpointId, hostname } };

      const handoff = yield* Effect.try({
        try: () => parseDatabaseHandoff({ version: 1, ...target, directUrl }, target),
        catch: () => new PreviewFailure({ operation: "Neon direct connection validation failed" }),
      });

      yield* save(target.identity);
      return handoff;
    });
}

function createNeonRemover(
  credentials: NeonDatabaseCredentials,
  api: NeonDatabaseApi,
): PreviewDatabaseAdapter["remove"] {
  return (target) =>
    Effect.gen(function* () {
      if (
        target.identity.provider !== "neon" ||
        target.identity.projectId !== credentials.projectId ||
        target.identity.parentBranchId !== credentials.parentBranchId
      ) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Neon cleanup project or parent drift" }),
        );
      }

      const result = yield* api.branchByName(target.name);

      if (result === null) {
        if (
          target.identity.branchId !== null &&
          (yield* api.request(`/branches/${encodeURIComponent(target.identity.branchId)}`)) !== null
        ) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Neon owned branch renamed; deletion denied" }),
          );
        }

        return yield* Effect.void;
      }

      const branchId = yield* checkedBranch(result, target, credentials);

      const deletion = yield* api.request(
        `/branches/${encodeURIComponent(branchId)}?hard_delete=true`,
        "DELETE",
      );

      yield* waitNeonDatabaseOperations(api, deletion);
      yield* waitNeonBranch(api, branchId, true);
      return yield* Effect.void;
    });
}

/** Neon implementation is selected by the composite action; core Cloudflare cleanup has no vendor logic. */
export function createNeonDatabaseAdapter(
  credentials: NeonDatabaseCredentials,
  api = createNeonDatabaseApi(credentials),
): PreviewDatabaseAdapter {
  return {
    provision: createNeonProvisioner(credentials, api),
    remove: createNeonRemover(credentials, api),
  };
}
