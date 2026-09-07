import {
  readPreviewMigrationFile,
  requirePreviewMigrationDirectory,
} from "./preview_migration_files.ts";
import { lstat, readdir, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { previewIo } from "../preview_model.ts";

const migrationArtifactLimitBytes = 8_388_608;
const migrationSqlLimitBytes = 1_048_576;
const migrationCountLimit = 256;

const migrationNameLimit = 160;

const MigrationNameSchema = z
  .string()
  .max(migrationNameLimit)
  .regex(/^[1-9]\d{13}_[a-zA-Z0-9_-]+$/u)
  .refine((name) => {
    const stamp = name.split("_")[0] ?? "";

    const isoDate = stamp.replace(
      /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})$/u,
      "$<year>-$<month>-$<day>T$<hour>:$<minute>:$<second>Z",
    );

    return z.iso.datetime().safeParse(isoDate).success;
  });

const MigrationArtifactSchema = z.strictObject({
  version: z.literal(1),
  dialect: z.literal("postgresql"),
  migrations: z
    .array(
      z.strictObject({
        name: MigrationNameSchema,
        sql: z
          .string()
          .min(1)
          .refine(
            (sql) =>
              !sql.includes("\0") &&
              new TextEncoder().encode(sql).byteLength <= migrationSqlLimitBytes,
          ),
      }),
    )
    .min(1)
    .max(migrationCountLimit)
    .refine(
      (migrations) =>
        new Set(migrations.map((migration) => migration.name.split("_")[0])).size ===
        migrations.length,
    ),
});

function parseMigrationArtifact(input: unknown) {
  const result = MigrationArtifactSchema.safeParse(input);

  if (!result.success) {
    throw new Error("Preview migration artifact contract rejected");
  }

  return result.data;
}

/** Package generated Drizzle SQL and ordering metadata; never load PR modules or configuration. */
export const buildPreviewMigrationArtifact = (sourceRoot: string, artifactRoot: string) =>
  previewIo("Preview migration artifact build failed", async () => {
    const directory = nodePath.resolve(sourceRoot, "packages/platform/migrations/drizzle");
    await requirePreviewMigrationDirectory(directory);

    const names = await readdir(directory);

    if (names.length === 0 || names.length > migrationCountLimit) {
      throw new Error("Preview migration count rejected");
    }

    const migrations = [];
    let bytes = 0;

    for (const name of names.toSorted()) {
      if (!MigrationNameSchema.safeParse(name).success) {
        throw new Error("Preview migration name rejected");
      }

      const folder = nodePath.join(directory, name);
      await requirePreviewMigrationDirectory(folder);

      const files = await readdir(folder);

      if (
        !files.includes("migration.sql") ||
        files.some((file) => !["migration.sql", "snapshot.json"].includes(file))
      ) {
        throw new Error("Preview migration source files rejected");
      }

      for (const file of files) {
        const stat = await lstat(nodePath.join(folder, file));

        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > migrationArtifactLimitBytes) {
          throw new Error("Preview migration source file rejected");
        }
      }

      const sql = await readPreviewMigrationFile(
        nodePath.join(folder, "migration.sql"),
        migrationSqlLimitBytes,
      );

      bytes += new TextEncoder().encode(sql).byteLength;

      if (bytes > migrationArtifactLimitBytes) {
        throw new Error("Preview migration source size rejected");
      }

      migrations.push({ name, sql });
    }

    const serialized = JSON.stringify(
      parseMigrationArtifact({ version: 1, dialect: "postgresql", migrations }),
    );

    const exceedsArtifactLimit =
      new TextEncoder().encode(serialized).byteLength > migrationArtifactLimitBytes;

    if (exceedsArtifactLimit) {
      throw new Error("Preview migration artifact size rejected");
    }

    await requirePreviewMigrationDirectory(artifactRoot);

    await writeFile(nodePath.join(artifactRoot, "migrations.json"), serialized, {
      flag: "wx",
      mode: 0o600,
    });
  });

/** Validate bounded SQL data and Drizzle folder metadata before any preview database connection. */
export const readPreviewMigrationArtifact = (artifactRoot: string) =>
  previewIo("Preview migration artifact validation failed", async () => {
    await requirePreviewMigrationDirectory(artifactRoot);

    const serialized = await readPreviewMigrationFile(
      nodePath.join(artifactRoot, "migrations.json"),
      migrationArtifactLimitBytes,
    );

    return parseMigrationArtifact(JSON.parse(serialized));
  });
