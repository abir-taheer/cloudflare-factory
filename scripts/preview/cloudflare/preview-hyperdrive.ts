import { executePreviewFile } from "./preview-command.ts";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewResource, previewString } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewCloudflare } from "./preview-cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview-state.ts";
import { readDatabaseHandoff } from "../../shared/database/database-contract.ts";

const migrationOutputLimitBytes = 1_048_576;

function migratePreviewDatabase(directUrl: string) {
  return Effect.tryPromise({
    try: async () => {
      await executePreviewFile(
        process.execPath,
        [
          nodePath.resolve("node_modules/tsx/dist/cli.mjs"),
          nodePath.resolve("scripts/preview/database/preview-migrate-cli.ts"),
        ],
        {
          cwd: process.cwd(),
          timeout: 120_000,
          encoding: "utf8",
          maxBuffer: migrationOutputLimitBytes,
          env: {
            PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
            HOME: "/tmp",
            DATABASE_URL: directUrl,
          },
        },
      );
    },
    catch: () =>
      new PreviewFailure({ operation: "Preview PostgreSQL migration failed; output suppressed" }),
  });
}

/** PostgreSQL is mandatory; only a validated private provider handoff can supply a Hyperdrive origin. */
export const provisionPreviewHyperdrive = (
  manifest: PreviewManifest,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const database = previewResource(manifest, "postgres");

    if (
      manifest.database === null ||
      database.phase !== "ready" ||
      database.id !== manifest.database.branchId
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview database handoff not ready" }),
      );
    }

    const handoff = yield* readDatabaseHandoff(previewString(process.env["DATABASE_OUTPUT_FILE"]), {
      owner: { ...manifest.owner, environment: "preview" },
      name: database.name,
      identity: manifest.database,
    });

    const url = new URL(handoff.directUrl);

    const origin = {
      scheme: "postgresql",
      host: url.hostname,
      port: Number(url.port || "5432"),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };

    const hyperdrive = previewResource(manifest, "hyperdrive");
    const existing = yield* cf.lookupResource(hyperdrive);

    if (
      (existing !== null && (hyperdrive.phase === "planned" || hyperdrive.phase === "deleted")) ||
      (hyperdrive.id !== null && hyperdrive.id !== existing)
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview Hyperdrive ownership mismatch" }),
      );
    }

    if (existing !== null) {
      const live = previewRecord(
        yield* cf.request(`/hyperdrive/configs/${encodeURIComponent(existing)}`),
      );

      const liveOrigin = previewRecord(live["origin"]);

      for (const key of ["scheme", "host", "port", "database", "user"] as const) {
        if (liveOrigin[key] !== origin[key]) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview Hyperdrive origin drift" }),
          );
        }
      }
    }

    yield* migratePreviewDatabase(handoff.directUrl);

    if (existing === null) {
      hyperdrive.phase = "creating";
      yield* state.save(manifest);

      const result = previewRecord(
        yield* cf.request("/hyperdrive/configs", "POST", {
          name: hyperdrive.name,
          origin,
          caching: { disabled: true },
          mtls: { sslmode: "verify-full" },
          origin_connection_limit: 5,
        }),
      );

      hyperdrive.id = previewString(result["id"]);
    } else {
      hyperdrive.id = existing;
    }

    if ((yield* cf.lookupResource(hyperdrive)) !== hyperdrive.id) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview Hyperdrive readback failed" }),
      );
    }

    hyperdrive.phase = "ready";
    yield* state.save(manifest);
    return yield* Effect.void;
  });
