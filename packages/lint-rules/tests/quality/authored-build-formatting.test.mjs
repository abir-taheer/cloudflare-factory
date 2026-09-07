import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("Prettier checks authored scripts/build files with the repository ignore configuration", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "factory-build-format-"));

  try {
    copyFileSync(".prettierignore", path.join(directory, ".prettierignore"));
    copyFileSync(".prettierrc.json", path.join(directory, ".prettierrc.json"));
    mkdirSync(path.join(directory, "scripts/build"), { recursive: true });

    const filename = path.join(directory, "scripts/build/build-fixture.ts");
    writeFileSync(filename, "export const ready=true;");

    const result = spawnSync(
      process.execPath,
      [path.resolve("node_modules/prettier/bin/prettier.cjs"), "--check", filename],
      { encoding: "utf8", cwd: directory, timeout: 30_000 },
    );

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes("scripts/build/build-fixture.ts"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
