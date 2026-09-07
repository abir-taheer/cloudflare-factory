import { ConfigProvider, Effect } from "effect";
import { Pool } from "pg";
import { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import { glob, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { migrateProductionDatabase, validateProductionMigrationSql } from "./production_migrate.ts";

test("production accepts current trusted additive Drizzle migrations", async () => {
  const root = nodePath.resolve("packages/platform/migrations/drizzle");

  const files: string[] = [];

  for await (const filename of glob("*/migration.sql", { cwd: root })) {
    files.push(filename);
  }

  assert.ok(files.length > 0);

  for (const filename of files) {
    const sql = await readFile(nodePath.join(root, filename), "utf8");
    validateProductionMigrationSql(sql);
  }
});

test("automatic production migrations reject destructive or executable SQL", () => {
  for (const sql of [
    "DROP TABLE notes;",
    "TRUNCATE notes;",
    "DELETE FROM notes;",
    "UPDATE notes SET text = NULL;",
    "ALTER TABLE notes DROP COLUMN text;",
    "CREATE OR REPLACE FUNCTION mutate() RETURNS void;",
    "CREATE TABLE additional (id TEXT); DROP TABLE notes;",
    "/* empty */",
  ]) {
    assert.throws(() => {
      validateProductionMigrationSql(sql);
    });
  }

  validateProductionMigrationSql("ALTER TABLE notes ADD COLUMN extra TEXT;");
  validateProductionMigrationSql("CREATE INDEX IF NOT EXISTS notes_text_idx ON notes (text);");
});

const integration = Effect.runSync(ConfigProvider.fromEnv().load(["PLATFORM_INTEGRATION"]));

test(
  "production child migrates trusted source without a preview artifact and reruns without data loss",
  {
    skip: integration?.value !== "1",
    timeout: 30_000,
  },
  async () => {
    const databaseSetting = await Effect.runPromise(
      ConfigProvider.fromEnv().load(["DATABASE_URL"]),
    );

    const connectionString = z.string().min(1).parse(databaseSetting?.value);
    const admin = new Pool({ connectionString });
    const databaseName = `production_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;

    const pool = new Pool({ connectionString: url.toString() });

    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      await Effect.runPromise(migrateProductionDatabase(url.toString()));

      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('production-migration-test', 'Test', 'production-migration@example.test', true, now(), now())`,
      );

      await Effect.runPromise(migrateProductionDatabase(url.toString()));

      const persisted = await pool.query(
        `SELECT email FROM "user" WHERE id = 'production-migration-test'`,
      );

      assert.deepEqual(persisted.rows, [{ email: "production-migration@example.test" }]);

      const previewTable = await pool.query(
        "SELECT to_regclass('public.preview_revision_feature') AS name",
      );

      assert.deepEqual(previewTable.rows, [{ name: null }]);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  },
);
