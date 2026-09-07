import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Exercise the actual config and CLI: RuleTester alone cannot prove a rule is enabled.
test("repository lint rejects an inline API schema through its configured JS plugin", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "factory-lint-"));
  const filename = path.join(directory, "route-contract.ts");

  try {
    writeFileSync(
      filename,
      'import { createRoute, z } from "@hono/zod-openapi"; export const route = createRoute({ responses: { 200: z.string() } }); if (!["GET", "POST"].includes("PUT")) { throw new Error("unsupported"); }',
    );

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/oxlint/bin/oxlint",
        "--config",
        ".oxlintrc.json",
        "--format",
        "json",
        filename,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr);

    const report = JSON.parse(result.stdout);

    assert.ok(
      report.diagnostics.some(
        (diagnostic) => diagnostic.code === "factory(no-inline-zod-in-create-route)",
      ),
      result.stdout,
    );

    assert.ok(
      report.diagnostics.some(
        (diagnostic) => diagnostic.code === "factory(require-named-complex-conditions)",
      ),
      result.stdout,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
