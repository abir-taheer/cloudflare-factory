import assert from "node:assert/strict";
import { test } from "node:test";
import { glob, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { validateProductionMigrationSql } from "./production-migrate.ts";

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
