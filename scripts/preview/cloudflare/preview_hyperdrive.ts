import { executePreviewFile } from "./preview_command.ts";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewResource, previewString } from "../preview_model.ts";
import type { PreviewManifest } from "../preview_model.ts";
import type { PreviewCloudflare } from "./preview_cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview_state.ts";
import { readDatabaseHandoff } from "../../shared/database/database_contract.ts";
import {
  hyperdriveConnectionPolicy,
  verifyHyperdriveConnectionPolicy,
} from "../../shared/database/hyperdrive_policy.ts";

const migrationOutputLimitBytes = 1_048_576;

function migratePreviewDatabase(directUrl: string, artifactRoot: string) {
  return Effect.tryPromise({
    try: async () => {
      await executePreviewFile(
        process.execPath,
        [
          nodePath.resolve("node_modules/tsx/dist/cli.mjs"),
          nodePath.resolve("scripts/preview/database/preview_migrate_cli.ts"),
          nodePath.resolve(artifactRoot),
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
  artifactRoot: string,
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

    const verifyReadback = (live: Record<string, unknown>, id: string) => {
      if (live["id"] !== id || live["name"] !== hyperdrive.name) {
        throw new PreviewFailure({ operation: "Preview Hyperdrive readback identity mismatch" });
      }

      const liveOrigin = previewRecord(live["origin"]);
      verifyHyperdriveConnectionPolicy(live);

      for (const key of ["scheme", "host", "port", "database", "user"] as const) {
        if (liveOrigin[key] !== origin[key]) {
          throw new PreviewFailure({ operation: "Preview Hyperdrive origin drift" });
        }
      }
    };

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

      verifyReadback(live, existing);
    }

    yield* migratePreviewDatabase(handoff.directUrl, artifactRoot);

    if (existing === null) {
      hyperdrive.phase = "creating";
      yield* state.save(manifest);

      const result = previewRecord(
        yield* cf.request("/hyperdrive/configs", "POST", {
          name: hyperdrive.name,
          origin,
          ...hyperdriveConnectionPolicy,
        }),
      );

      hyperdrive.id = previewString(result["id"]);
      yield* state.save(manifest);
    } else {
      hyperdrive.id = existing;
    }

    if ((yield* cf.lookupResource(hyperdrive)) !== hyperdrive.id) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview Hyperdrive readback failed" }),
      );
    }

    const readback = previewRecord(yield* cf.request(`/hyperdrive/configs/${hyperdrive.id}`));

    verifyReadback(readback, previewString(hyperdrive.id));

    hyperdrive.phase = "ready";
    yield* state.save(manifest);
    return yield* Effect.void;
  });
