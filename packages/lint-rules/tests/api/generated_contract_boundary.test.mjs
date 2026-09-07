import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("generated declaration style exemption preserves neighboring authored declarations and security", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "factory-generated-lint-"));

  try {
    symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"));

    const config = JSON.parse(readFileSync(".oxlintrc.json", "utf8"));

    config.jsPlugins = [
      { name: "factory", specifier: path.resolve("packages/lint-rules/factory_lint_plugin.mjs") },
    ];

    writeFileSync(path.join(directory, ".oxlintrc.json"), JSON.stringify(config));

    const sourceDirectory = path.join(directory, "packages/api-client/src");
    mkdirSync(sourceDirectory, { recursive: true });

    const generatedFile = path.join(sourceDirectory, "api_paths.d.ts");
    const authoredFile = path.join(sourceDirectory, "authored-paths.d.ts");
    const declaration = "export interface ResponseMap { 201: string; }";

    writeFileSync(generatedFile, `import type { Schema } from "effect";\n${declaration}`);
    writeFileSync(authoredFile, declaration);

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/oxlint/bin/oxlint",
        "--config",
        ".oxlintrc.json",
        "--format",
        "json",
        generatedFile,
        authoredFile,
      ],
      { encoding: "utf8", cwd: directory, timeout: 30_000 },
    );

    assert.equal(result.status, 1, result.stderr);

    const report = JSON.parse(result.stdout);

    const generatedDiagnostics = report.diagnostics.filter((entry) =>
      entry.filename.endsWith("/api_paths.d.ts"),
    );

    const authoredDiagnostics = report.diagnostics.filter((entry) =>
      entry.filename.endsWith("/authored-paths.d.ts"),
    );

    assert.ok(
      authoredDiagnostics.some((entry) => entry.code === "eslint(no-magic-numbers)"),
      result.stdout,
    );

    assert.ok(
      !generatedDiagnostics.some((entry) => entry.code === "eslint(no-magic-numbers)"),
      result.stdout,
    );

    assert.ok(
      generatedDiagnostics.some((entry) => entry.code === "factory(no-effect-schema)"),
      result.stdout,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
