import { executeProductionFile } from "./production-control.ts";
import { glob, lstat, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { previewIo } from "../preview/preview-model.ts";

const maximumMigrationOutputBytes = 1_048_576;

/** Conservative allowlist: automatic production migrations can only add tables, indexes or columns. */
export const validateProductionMigrationSql = (sql: string) => {
  const statements = sql
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/--[^\n]*/gu, "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    statements.length === 0 ||
    statements.some(
      (statement) =>
        !/^(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s|ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN|CONSTRAINT)\s)/iu.test(
          statement,
        ) ||
        /\b(?:DROP|TRUNCATE|DELETE|UPDATE|RENAME|REPLACE|EXECUTE|CALL|ATTACH|COPY)\b/iu.test(
          statement.replaceAll(
            /\bON\s+DELETE\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)\b/giu,
            "",
          ),
        ),
    )
  ) {
    throw new Error("Production migration is not additive");
  }
};

/** Only the trusted migration entrypoint runs, with PostgreSQL credentials and no CI/app credentials. */
export const migrateProductionDatabase = (directUrl: string) =>
  previewIo("Production PostgreSQL migration failed", async () => {
    const root = nodePath.resolve("packages/platform/migrations/drizzle");
    const entries: string[] = [];

    for await (const entry of glob("*/migration.sql", { cwd: root })) {
      entries.push(entry);
    }

    if (entries.length === 0) {
      throw new Error("Production migrations missing");
    }

    for (const entry of entries) {
      const path = nodePath.join(root, entry);
      const directory = await lstat(nodePath.dirname(path));
      const stat = await lstat(path);

      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        !stat.isFile() ||
        stat.isSymbolicLink()
      ) {
        throw new Error("Production migration shape invalid");
      }

      const sql = await readFile(path, "utf8");
      validateProductionMigrationSql(sql);
    }

    await executeProductionFile(
      process.execPath,
      ["--import", "tsx", nodePath.resolve("scripts/preview/database/preview-migrate-cli.ts")],
      {
        cwd: nodePath.resolve("."),
        timeout: 120_000,
        maxBuffer: maximumMigrationOutputBytes,
        env: { PATH: "/usr/local/bin:/usr/bin:/bin", DATABASE_URL: directUrl },
      },
    );
  });
