import { z } from "zod";
import { Effect } from "effect";
import { loadDeploymentDoppler } from "../deployment-doppler.ts";
import {
  PreviewFailure,
  previewIo,
  previewRecord,
  previewString,
} from "../../preview/preview-model.ts";

const neonTimeoutMs = 60_000;
const httpNotFound = 404;
const httpNoContent = 204;
const branchPageLimit = 1000;
const operationPollLimit = 60;

/** Replaceable Neon REST boundary; provider response bodies never enter errors or logs. */
export interface NeonDatabaseApi {
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Effect.Effect<Record<string, unknown> | null, PreviewFailure>;
  branchByName: (name: string) => Effect.Effect<Record<string, unknown> | null, PreviewFailure>;
}

const NeonCredentialsSchema = z.object({
  NEON_PROJECT_ID: z.string().regex(/^[a-z0-9-]{1,60}$/u),
  NEON_PARENT_BRANCH_ID: z.string().regex(/^br-[a-z0-9-]{1,57}$/u),
  NEON_API_KEY: z.string().min(1),
  NEON_DATABASE_NAME: z.string().min(1),
  NEON_ROLE_NAME: z.string().min(1),
});

const NeonDatabaseCredentialsSchema = NeonCredentialsSchema.transform((config) => ({
  projectId: config.NEON_PROJECT_ID,
  parentBranchId: config.NEON_PARENT_BRANCH_ID,
  apiKey: config.NEON_API_KEY,
  databaseName: config.NEON_DATABASE_NAME,
  roleName: config.NEON_ROLE_NAME,
}));

/** Neon credentials follow the selected deployment config projection. */
export type NeonDatabaseCredentials = z.infer<typeof NeonDatabaseCredentialsSchema>;

/** Independently pinned project and immutable parent IDs prevent production/default-branch fallbacks. */
export const loadNeonDatabaseCredentials = (environment: "preview" | "prod") =>
  Effect.gen(function* () {
    const config = yield* loadDeploymentDoppler("DEPLOY", environment);

    return yield* Effect.try({
      try: () => {
        const result = NeonDatabaseCredentialsSchema.safeParse(config);

        if (!result.success) {
          throw new Error("Neon credentials invalid");
        }

        const validated = result.data;
        const projectId = validated.projectId;
        const parentBranchId = validated.parentBranchId;

        if (
          projectId !== process.env["NEON_PROJECT_ID"] ||
          parentBranchId !== process.env["NEON_PARENT_BRANCH_ID"]
        ) {
          throw new Error("Neon identity mismatch");
        }

        return validated;
      },
      catch: () =>
        new PreviewFailure({
          operation: "Neon independent project and parent verification failed",
        }),
    });
  });

/** Exact-name inventory lookup paginates and rejects duplicates instead of adopting the first match. */
export function createNeonDatabaseApi(credentials: NeonDatabaseCredentials): NeonDatabaseApi {
  const request: NeonDatabaseApi["request"] = (path, method, body) =>
    previewIo("Neon database API request failed", async () => {
      if (!path.startsWith("/") || path.includes("..")) {
        throw new Error("Neon API path invalid");
      }

      const requestBody: Pick<RequestInit, "body"> = {};

      if (body !== undefined) {
        requestBody.body = JSON.stringify(body);
      }

      const response = await fetch(
        `https://console.neon.tech/api/v2/projects/${credentials.projectId}${path}`,
        {
          method: method ?? "GET",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
          },
          ...requestBody,
          redirect: "error",
          signal: AbortSignal.timeout(neonTimeoutMs),
        },
      );

      if (response.status === httpNotFound) {
        return null;
      }

      if (!response.ok) {
        throw new Error("Neon request failed");
      }

      if (response.status === httpNoContent) {
        return {};
      }

      const result: unknown = await response.json();
      return previewRecord(result);
    });

  const branchByName: NeonDatabaseApi["branchByName"] = (name) =>
    Effect.gen(function* () {
      const matches: Record<string, unknown>[] = [];
      let cursor = "";
      const seen = new Set<string>();

      for (let page = 0; page < branchPageLimit; page += 1) {
        const query = new URLSearchParams({
          search: name,
          limit: "100",
        });

        if (cursor !== "") {
          query.set("cursor", cursor);
        }

        const result = yield* request(`/branches?${query}`);

        if (result === null || !Array.isArray(result["branches"])) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Neon branch inventory unavailable" }),
          );
        }

        for (const value of result["branches"]) {
          const branch = previewRecord(value);

          if (branch["name"] === name) {
            matches.push(branch);
          }
        }

        const next =
          result["pagination"] === undefined
            ? undefined
            : previewRecord(result["pagination"])["next"];

        if (next === undefined || next === null || next === "") {
          if (matches.length > 1) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Neon duplicate branch name rejected" }),
            );
          }

          const branch = matches[0];

          if (branch === undefined) {
            return null;
          }

          return yield* request(`/branches/${encodeURIComponent(previewString(branch["id"]))}`);
        }

        cursor = previewString(next);

        if (seen.has(cursor)) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Neon branch inventory cursor stalled" }),
          );
        }

        seen.add(cursor);
      }

      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon branch inventory limit exceeded" }),
      );
    });

  return { request, branchByName };
}

/** Explicit branch, endpoint and pooled=false prevent accidental use of the default or pooled origin. */
export const readNeonDirectConnection = (
  credentials: NeonDatabaseCredentials,
  api: NeonDatabaseApi,
  branchId: string,
  endpointId: string,
  databaseName = credentials.databaseName,
) =>
  api
    .request(
      `/connection_uri?${new URLSearchParams({
        branch_id: branchId,
        endpoint_id: endpointId,
        database_name: databaseName,
        role_name: credentials.roleName,
        pooled: "false",
      })}`,
    )
    .pipe(Effect.map((result) => previewString(result?.["uri"])));

/** Neon mutations can return before computes or passwords are ready; wait without repeating POSTs. */
export const waitNeonDatabaseOperations = (
  api: NeonDatabaseApi,
  result: Record<string, unknown> | null,
) =>
  Effect.gen(function* () {
    if (result === null) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon mutation returned no result" }),
      );
    }

    const operations = result["operations"] ?? [];

    if (!Array.isArray(operations)) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon operation response invalid" }),
      );
    }

    for (const item of operations) {
      let operation = previewRecord(item);
      const id = previewString(operation["id"]);

      for (let attempt = 0; operation["status"] !== "finished"; attempt += 1) {
        if (
          attempt >= operationPollLimit ||
          operation["status"] === "cancelled" ||
          operation["status"] === "skipped"
        ) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Neon asynchronous operation did not succeed" }),
          );
        }

        yield* Effect.sleep("2 seconds");

        const response = yield* api.request(`/operations/${encodeURIComponent(id)}`);
        operation = previewRecord(response?.["operation"]);
      }
    }

    return yield* Effect.void;
  });
