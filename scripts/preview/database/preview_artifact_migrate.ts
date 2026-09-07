import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import { migratePostgres } from "@factory/platform/migrate";
import { readPreviewMigrationArtifact } from "./preview_migration_artifact.ts";
import { previewIo } from "../preview_model.ts";

/** Run only the trusted Drizzle migrator against a private copy of validated PR SQL. */
export const migratePreviewArtifact = (databaseUrl: string, artifactRoot: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const artifact = yield* readPreviewMigrationArtifact(artifactRoot);

      const directory = yield* Effect.acquireRelease(
        previewIo("Preview migration staging failed", () => mkdtemp("/tmp/preview-migrations-")),
        (folder) =>
          previewIo("Preview migration staging cleanup failed", () =>
            rm(folder, { recursive: true, force: true }),
          ).pipe(Effect.orDie),
      );

      yield* previewIo("Preview migration materialization failed", async () => {
        for (const migration of artifact.migrations) {
          const folder = nodePath.join(directory, migration.name);

          await mkdir(folder, { mode: 0o700 });

          await writeFile(nodePath.join(folder, "migration.sql"), migration.sql, {
            flag: "wx",
            mode: 0o600,
          });
        }
      });

      yield* migratePostgres(databaseUrl, directory);
    }),
  );
