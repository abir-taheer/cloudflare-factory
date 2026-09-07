import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import {
  buildPreviewMigrationArtifact,
  readPreviewMigrationArtifact,
} from "./preview_migration_artifact.ts";
import { validatePreviewArtifacts } from "../cloudflare/preview_runtime_files.ts";

async function createMigrationFixture() {
  const root = await mkdtemp("/tmp/preview-migration-test-");
  const source = nodePath.join(root, "source");
  const artifact = nodePath.join(root, "artifact");
  const migrations = nodePath.join(source, "packages/platform/migrations/drizzle");

  await mkdir(artifact);
  await cp("packages/platform/migrations/drizzle", migrations, { recursive: true });
  return { root, source, artifact, migrations };
}

test("migration artifact preserves generated SQL and Drizzle metadata without snapshot or code", async () => {
  const fixture = await createMigrationFixture();

  try {
    await Effect.runPromise(buildPreviewMigrationArtifact(fixture.source, fixture.artifact));

    const artifact = await Effect.runPromise(readPreviewMigrationArtifact(fixture.artifact));

    for (const migration of artifact.migrations) {
      const sql = await readFile(
        nodePath.join(fixture.migrations, migration.name, "migration.sql"),
        "utf8",
      );

      assert.equal(migration.sql, sql);
    }

    await mkdir(nodePath.join(fixture.artifact, "assets"));

    for (const app of ["api", "frontend", "workflows"]) {
      await writeFile(
        nodePath.join(fixture.artifact, `${app}.mjs`),
        "throw new Error('PR modules must never execute');",
      );
    }

    await Effect.runPromise(validatePreviewArtifacts(fixture.artifact));
    await writeFile(nodePath.join(fixture.artifact, "hook.mjs"), "");
    await assert.rejects(Effect.runPromise(validatePreviewArtifacts(fixture.artifact)));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

const migration = { name: "20260907101803_auth-notes", sql: "SELECT 1;" };
const validArtifact = { version: 1, dialect: "postgresql", migrations: [migration] };

for (const [label, input] of Object.entries({
  "invalid JSON": "{",
  "wrong version": JSON.stringify({ ...validArtifact, version: 2 }),
  "wrong dialect": JSON.stringify({ ...validArtifact, dialect: "sqlite" }),
  "unknown metadata": JSON.stringify({ ...validArtifact, hook: "evil.mjs" }),
  "empty migrations": JSON.stringify({ ...validArtifact, migrations: [] }),
  "duplicate names": JSON.stringify({ ...validArtifact, migrations: [migration, migration] }),
  "duplicate timestamps": JSON.stringify({
    ...validArtifact,
    migrations: [migration, { ...migration, name: "20260907101803_other" }],
  }),
  "traversal name": JSON.stringify({
    ...validArtifact,
    migrations: [{ ...migration, name: "../../outside" }],
  }),
  "invalid date": JSON.stringify({
    ...validArtifact,
    migrations: [{ ...migration, name: "20260230000000_invalid" }],
  }),
  "non-string SQL": JSON.stringify({ ...validArtifact, migrations: [{ ...migration, sql: {} }] }),
  "SQL NUL": JSON.stringify({ ...validArtifact, migrations: [{ ...migration, sql: "\0" }] }),
  "oversize SQL": JSON.stringify({
    ...validArtifact,
    migrations: [{ ...migration, sql: "x".repeat(1_048_577) }],
  }),
})) {
  test(`migration artifact rejects ${label}`, async () => {
    const root = await mkdtemp("/tmp/preview-migration-invalid-");

    try {
      await writeFile(nodePath.join(root, "migrations.json"), input);
      await assert.rejects(Effect.runPromise(readPreviewMigrationArtifact(root)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const kind of [
  "artifact-link",
  "ancestor-link",
  "artifact-directory",
  "oversize-artifact",
  "source-sql-link",
  "source-folder-link",
  "source-module",
]) {
  test(`migration boundary rejects ${kind}`, async () => {
    const fixture = await createMigrationFixture();

    try {
      const artifactFile = nodePath.join(fixture.artifact, "migrations.json");
      const sourceFolder = nodePath.join(fixture.migrations, migration.name);
      const outside = nodePath.join(fixture.root, "outside");
      await writeFile(outside, JSON.stringify(validArtifact));

      if (kind === "artifact-link") {
        await symlink(outside, artifactFile);
      } else if (kind === "ancestor-link") {
        await symlink(fixture.artifact, nodePath.join(fixture.root, "linked"));
        await writeFile(artifactFile, JSON.stringify(validArtifact));

        await assert.rejects(
          Effect.runPromise(readPreviewMigrationArtifact(nodePath.join(fixture.root, "linked"))),
        );

        return;
      } else if (kind === "artifact-directory") {
        await mkdir(artifactFile);
      } else if (kind === "oversize-artifact") {
        await writeFile(artifactFile, "");
        await truncate(artifactFile, 8_388_609);
      } else {
        if (kind === "source-sql-link") {
          await rm(nodePath.join(sourceFolder, "migration.sql"));
          await symlink(outside, nodePath.join(sourceFolder, "migration.sql"));
        } else if (kind === "source-folder-link") {
          await rm(sourceFolder, { recursive: true });
          await symlink(fixture.artifact, sourceFolder);
        } else {
          await writeFile(
            nodePath.join(sourceFolder, "hook.mjs"),
            "throw new Error('must not execute');",
          );
        }

        await assert.rejects(
          Effect.runPromise(buildPreviewMigrationArtifact(fixture.source, fixture.artifact)),
        );

        return;
      }

      await assert.rejects(Effect.runPromise(readPreviewMigrationArtifact(fixture.artifact)));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test("migration artifact accepts 256 migrations and rejects 257", async () => {
  const root = await mkdtemp("/tmp/preview-migration-count-");
  const maximumMigrations = 256;
  const minuteMilliseconds = 60_000;
  const timestampStart = Date.UTC(2026, 0, 1);

  const migrations = Array.from({ length: maximumMigrations + 1 }, (_, index) => ({
    sql: migration.sql,
    name: `${new Date(timestampStart + index * minuteMilliseconds)
      .toISOString()
      .replaceAll(/[-:TZ.]/gu, "")
      .slice(0, 14)}_test`,
  }));

  try {
    const artifactPath = nodePath.join(root, "migrations.json");

    await writeFile(
      artifactPath,
      JSON.stringify({ ...validArtifact, migrations: migrations.slice(0, maximumMigrations) }),
    );

    const accepted = await Effect.runPromise(readPreviewMigrationArtifact(root));
    assert.equal(accepted.migrations.length, maximumMigrations);

    await writeFile(artifactPath, JSON.stringify({ ...validArtifact, migrations }));
    await assert.rejects(Effect.runPromise(readPreviewMigrationArtifact(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
