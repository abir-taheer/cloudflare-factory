import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { findPathConventionViolations } from "../path-conventions.mjs";

const executePathChecker = promisify(execFile);

async function withPathFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "path-conventions-"));

  const addFile = async (relativePath) => {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), "");
  };

  try {
    await run(root, addFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("path naming accepts kebab files, compound extensions and scoped tooling names", async () => {
  await withPathFixture(async (root, addFile) => {
    const filenames = [
      "AGENTS.md",
      "Dockerfile",
      "package-lock.json",
      ".prettierrc.json",
      ".prettierignore",
      ".github/workflows/check-paths.yml",
      ".github/CODEOWNERS",
      ".github/ISSUE_TEMPLATE/bug-report.yml",
      "apps/api/.env.example",
      "apps/api/README.md",
      "apps/api/src/session-user.test.ts",
      "packages/platform/migrations/drizzle/20260102030405_auth-notes/migration.sql",
    ];

    await Promise.all(filenames.map((filename) => addFile(filename)));

    const violations = await findPathConventionViolations(root);
    assert.deepEqual(violations, []);
  });
});

test("path naming finds empty mixed-case folders, untracked files and misplaced exceptions", async () => {
  await withPathFixture(async (root, addFile) => {
    await mkdir(path.join(root, "apps/api/BadFolder"), { recursive: true });

    const filenames = [
      "apps/api/src/user_name.ts",
      "apps/api/src/userName.ts",
      "apps/api/src/.github/check.ts",
      "scripts/20260102030405_auth-notes/task.ts",
    ];

    await Promise.all(filenames.map((filename) => addFile(filename)));

    const violations = await findPathConventionViolations(root);

    const expectedOffenders = 5;

    assert.equal(violations.length, expectedOffenders);
    assert.ok(violations.some((value) => value.startsWith("apps/api/BadFolder:")));
    assert.ok(violations.some((value) => value.startsWith("scripts/20260102030405_auth-notes:")));
  });
});

test("path naming excludes generated outputs only at declared roots and never follows symlinks", async () => {
  await withPathFixture(async (root, addFile) => {
    const filenames = [
      "node_modules/VendorPackage/index.js",
      "apps/api/dist/GeneratedFile.js",
      "packages/platform/src/dist/BadFile.ts",
    ];

    await Promise.all(filenames.map((filename) => addFile(filename)));

    await symlink(root, path.join(root, "recursive-link"));

    const violations = await findPathConventionViolations(root);

    assert.deepEqual(violations, [
      "packages/platform/src/dist/BadFile.ts: file name must use kebab-case",
    ]);
  });
});

test("path naming CLI fails on offenders and passes after an actual rename", async () => {
  const checker = path.resolve("packages/lint-rules/path-conventions.mjs");

  await withPathFixture(async (root, addFile) => {
    await addFile("bad_name.ts");

    await assert.rejects(executePathChecker(process.execPath, [checker], { cwd: root }), {
      code: 1,
    });

    await rename(path.join(root, "bad_name.ts"), path.join(root, "good-name.ts"));
    await executePathChecker(process.execPath, [checker], { cwd: root });
  });
});

test("dynamic route directories admit lower-kebab parameters only inside API routes", async () => {
  await withPathFixture(async (root, addFile) => {
    const accepted = [
      "apps/api/src/routes/api/v1/notes/[id]/get.ts",
      "apps/api/src/routes/notes/[note-id]/post.ts",
      "apps/api/src/routes/openapi/get.ts",
    ];

    await Promise.all(accepted.map((filename) => addFile(filename)));

    const valid = await findPathConventionViolations(root);
    assert.deepEqual(valid, []);

    const rejected = [
      "apps/api/src/routes/[noteId]/get.ts",
      "apps/api/src/routes/[note_id]/get.ts",
      "apps/frontend/src/[id]/get.ts",
      "apps/api/src/routes/[...id]/get.ts",
    ];

    await Promise.all(rejected.map((filename) => addFile(filename)));

    const invalid = await findPathConventionViolations(root);
    assert.equal(invalid.length, rejected.length);
  });
});

test("folder file limit accepts twenty including docs and CLI rejects twenty-one until regrouped", async () => {
  const checker = path.resolve("packages/lint-rules/path-conventions.mjs");

  await withPathFixture(async (root, addFile) => {
    const sourceFileCount = 19;

    await Promise.all(
      Array.from({ length: sourceFileCount }, (_, index) => addFile(`file-${index}.ts`)),
    );

    await addFile("README.md");
    await executePathChecker(process.execPath, [checker], { cwd: root });
    await addFile("extra-file.test.ts");

    const violations = await findPathConventionViolations(root);
    assert.equal(violations.length, 1);

    await assert.rejects(executePathChecker(process.execPath, [checker], { cwd: root }), {
      code: 1,
    });

    await mkdir(path.join(root, "tests"));

    await rename(
      path.join(root, "extra-file.test.ts"),
      path.join(root, "tests/extra-file.test.ts"),
    );

    await executePathChecker(process.execPath, [checker], { cwd: root });
  });
});

test("folder file limit excludes scoped generated outputs and counts files rather than directories", async () => {
  await withPathFixture(async (root, addFile) => {
    const overLimitCount = 21;

    await Promise.all(
      Array.from({ length: overLimitCount }, async (_, index) => {
        await addFile(`apps/api/dist/file-${index}.js`);
        await addFile(`node_modules/vendor/file-${index}.js`);
        await addFile(`packages/platform/src/dist/file-${index}.ts`);
        await mkdir(path.join(root, `folder-${index}`));
      }),
    );

    const violations = await findPathConventionViolations(root);

    assert.equal(violations.length, 1);
    assert.ok(violations.some((value) => value.startsWith("packages/platform/src/dist:")));
  });
});
