import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { ConfigProvider, Effect } from "effect";
import { Pool } from "pg";
import { z } from "zod";
import { migratePostgres } from "@factory/platform/migrate";
import { executePreviewFile } from "../cloudflare/preview_command.ts";
import { buildPreviewMigrationArtifact } from "./preview_migration_artifact.ts";

const integration = Effect.runSync(ConfigProvider.fromEnv().load(["PLATFORM_INTEGRATION"]));

async function generatePreviewMigrationFixture(root: string) {
  const source = nodePath.join(root, "source");
  const artifact = nodePath.join(root, "artifact");
  const migrationFolder = nodePath.join(source, "packages/platform/migrations/drizzle");

  await mkdir(artifact);
  await cp("packages/platform/migrations/drizzle", migrationFolder, { recursive: true });

  const schemaFolder = nodePath.join(root, "schema");

  await cp("packages/platform/src/adapters/database/schema", schemaFolder, { recursive: true });
  // The generator resolves the pinned dependencies from the trusted workspace.
  await writeFile(nodePath.join(root, "package.json"), JSON.stringify({ type: "module" }));

  await writeFile(
    nodePath.join(schemaFolder, "preview-revision-feature.ts"),
    `import { pgTable, text } from ${JSON.stringify(nodePath.resolve("node_modules/drizzle-orm/pg-core/index.js"))};\nexport const previewRevisionFeature = pgTable("preview_revision_feature", { value: text("value").notNull() });\n`,
  );

  // Existing schemas import drizzle-orm by package name, so make dependencies available to generation only.

  await symlink(nodePath.resolve("node_modules"), nodePath.join(root, "node_modules"));

  await executePreviewFile(
    process.execPath,
    [
      nodePath.resolve("node_modules/drizzle-kit/bin.cjs"),
      "generate",
      "--dialect=postgresql",
      `--schema=${schemaFolder}/*.ts`,
      `--out=${migrationFolder}`,
      "--name=preview-revision-feature",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp" },
    },
  );

  await Effect.runPromise(buildPreviewMigrationArtifact(source, artifact));

  return artifact;
}

test(
  "trusted preview child applies Drizzle-generated PR-only table and preserves it on rerun",
  {
    skip: integration?.value !== "1",
    timeout: 120_000,
  },
  async () => {
    const databaseSetting = await Effect.runPromise(
      ConfigProvider.fromEnv().load(["DATABASE_URL"]),
    );

    const connectionString = z.string().min(1).parse(databaseSetting?.value);
    const admin = new Pool({ connectionString });
    const databaseName = `preview_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;

    const pool = new Pool({ connectionString: url.toString() });
    const root = await mkdtemp("/tmp/preview-migration-postgres-");

    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      await Effect.runPromise(migratePostgres(url.toString()));

      const before = await pool.query(
        "SELECT to_regclass('public.preview_revision_feature') AS name",
      );

      assert.deepEqual(before.rows, [{ name: null }]);

      const artifact = await generatePreviewMigrationFixture(root);

      await writeFile(
        nodePath.join(artifact, "package.json"),
        JSON.stringify({ scripts: { preinstall: "exit 99" } }),
      );

      await writeFile(nodePath.join(artifact, "api.mjs"), "throw new Error('PR module executed');");

      const migrate = () =>
        executePreviewFile(
          process.execPath,
          [
            nodePath.resolve("node_modules/tsx/dist/cli.mjs"),
            nodePath.resolve("scripts/preview/database/preview_migrate_cli.ts"),
            artifact,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 30_000,
            env: {
              PATH: "/usr/local/bin:/usr/bin:/bin",
              HOME: "/tmp",
              DATABASE_URL: url.toString(),
            },
          },
        );

      await migrate();
      await pool.query("INSERT INTO preview_revision_feature (value) VALUES ('PR-only data')");
      await migrate();

      const persisted = await pool.query("SELECT value FROM preview_revision_feature");

      assert.deepEqual(persisted.rows, [{ value: "PR-only data" }]);

      await writeFile(
        nodePath.join(artifact, "migrations.json"),
        JSON.stringify({
          version: 1,
          dialect: "postgresql",
          migrations: [
            { name: "20260907101803_rejected", sql: "DROP TABLE preview_revision_feature;" },
            { name: "../../escape", sql: "SELECT 1;" },
          ],
        }),
      );

      await assert.rejects(migrate());

      // Production's default still reads only the trusted source migrations, even with a malformed PR artifact.
      await Effect.runPromise(migratePostgres(url.toString()));

      const afterDefault = await pool.query("SELECT value FROM preview_revision_feature");

      assert.deepEqual(afterDefault.rows, [{ value: "PR-only data" }]);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
