import { Effect } from "effect";
import { Client } from "pg";
import {
  PreviewFailure,
  previewIo,
  previewRecord,
  previewString,
} from "../../preview/preview_model.ts";
import { readNeonDirectConnection } from "./neon_api.ts";
import type { NeonDatabaseApi, NeonDatabaseCredentials } from "./neon_api.ts";

interface NeonBaselinePresence {
  present: boolean;
}

/** An EMPTY baseline contains no user tables in any inherited database, including postgres. */
export const verifyNeonEmptyBaseline = (
  credentials: NeonDatabaseCredentials,
  api: NeonDatabaseApi,
) =>
  Effect.gen(function* () {
    const parent = yield* api.request(`/branches/${credentials.parentBranchId}`);
    const branch = previewRecord(parent?.["branch"]);

    if (
      branch["id"] !== credentials.parentBranchId ||
      branch["project_id"] !== credentials.projectId ||
      branch["current_state"] !== "ready"
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon EMPTY baseline identity unavailable" }),
      );
    }

    const endpointResult = yield* api.request(`/branches/${credentials.parentBranchId}/endpoints`);
    const endpoints = endpointResult?.["endpoints"];

    if (!Array.isArray(endpoints)) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon baseline endpoint unavailable" }),
      );
    }

    const writers = endpoints
      .map((value: unknown) => previewRecord(value))
      .filter((endpoint) => endpoint["type"] === "read_write");

    if (writers.length !== 1) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon baseline writer ambiguous" }),
      );
    }

    const endpoint = previewRecord(writers[0]);

    if (
      endpoint["branch_id"] !== credentials.parentBranchId ||
      endpoint["project_id"] !== credentials.projectId
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon baseline endpoint identity mismatch" }),
      );
    }

    const databaseResult = yield* api.request(`/branches/${credentials.parentBranchId}/databases`);
    const databases = databaseResult?.["databases"];

    if (!Array.isArray(databases) || databases.length === 0) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon baseline databases unavailable" }),
      );
    }

    for (const item of databases) {
      const name = previewString(previewRecord(item)["name"]);

      const directUrl = yield* readNeonDirectConnection(
        credentials,
        api,
        credentials.parentBranchId,
        previewString(endpoint["id"]),
        name,
      );

      yield* previewIo("Neon baseline must contain no application tables", async () => {
        const url = new URL(directUrl);

        if (
          url.hostname !== endpoint["host"] ||
          url.hostname.includes("-pooler") ||
          url.protocol !== "postgresql:"
        ) {
          throw new Error("Neon baseline origin mismatch");
        }

        url.search = "";

        const client = new Client({
          connectionString: url.toString(),
          ssl: { rejectUnauthorized: true },
          connectionTimeoutMillis: 30_000,
          query_timeout: 30_000,
          statement_timeout: 30_000,
        });

        try {
          await client.connect();

          const result = await client.query<NeonBaselinePresence>(
            "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%') AS present",
          );

          if (result.rows[0]?.present !== false) {
            throw new Error("Neon baseline contains tables");
          }
        } finally {
          await client.end();
        }
      });
    }

    return yield* Effect.void;
  });
