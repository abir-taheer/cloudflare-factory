import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { requireSchemaDerivedContracts } from "../../rules/api/require_schema_derived_contracts.mjs";
import { preferAwaitToCallbacks } from "../../rules/effect/prefer_await_to_callbacks.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("schema-derived-contracts", requireSchemaDerivedContracts, {
  valid: [
    "const InputSchema = z.object({ name: z.string() }); type Input = z.infer<typeof InputSchema>;",
    'const InputSchema = z.object({ name: z.string() }); type Input = Pick<z.input<typeof InputSchema>, "name">;',
    "interface Storage { read(key: string): Promise<string>; }",
    "const StorageSchema = z.object({}); interface Storage { read(key: string): Promise<string>; }",
    "const InputSchema = buildAdapter(); interface Input { name: string; }",
  ],
  invalid: [
    {
      code: "const BaseSchema = z.object({ name: z.string() }); const InputSchema = BaseSchema.pick({ name: true }); interface Input { name: string; }",
      errors: [{ messageId: "deriveContract" }],
    },
    {
      code: "const InputSchema = z.object({ name: z.string() }); interface Input { name: string; }",
      errors: [{ messageId: "deriveContract" }],
    },
    {
      code: "type Input = { name: string }; const InputSchema = z.object({ name: z.string() });",
      errors: [{ messageId: "deriveContract" }],
    },
  ],
});

ruleTester.run("promisify-callback-adapter", preferAwaitToCallbacks, {
  valid: [
    'import { promisify } from "node:util"; const run = promisify((callback) => { execute(callback); });',
  ],
  invalid: [
    {
      code: 'import { promisify } from "other-package"; const run = promisify((callback) => { execute(callback); });',
      errors: [{ messageId: "preferAwait" }],
    },
    {
      code: 'import { promisify } from "node:util"; function test(promisify) { return promisify((callback) => { execute(callback); }); }',
      errors: [{ messageId: "preferAwait" }],
    },
  ],
});

test("configured CLI rejects legacy schemas, named untyped routes and duplicate data contracts", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "factory-review-lint-"));

  try {
    symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"));

    const config = JSON.parse(readFileSync(".oxlintrc.json", "utf8"));

    config.jsPlugins = [
      { name: "factory", specifier: path.resolve("packages/lint-rules/factory_lint_plugin.mjs") },
    ];

    writeFileSync(path.join(directory, ".oxlintrc.json"), JSON.stringify(config));

    const routeDirectory = path.join(directory, "apps/api/src/routes");
    mkdirSync(routeDirectory, { recursive: true });

    const buildDirectory = path.join(directory, "scripts/build");
    mkdirSync(buildDirectory, { recursive: true });

    const buildFilename = path.join(buildDirectory, "invalid-build.ts");

    writeFileSync(
      buildFilename,
      'if (["GET"].includes("POST")) { throw new Error("unsupported"); }',
    );

    writeFileSync(
      path.join(directory, "legacy.ts"),
      'import { z } from "zod/v3"; export const InputSchema = z.string();',
    );

    writeFileSync(
      path.join(routeDirectory, "get.ts"),
      'import { OpenAPIHono } from "@hono/zod-openapi"; const app = new OpenAPIHono(); const routePath = "/notes"; app.get(routePath, (context) => context.text("ok"));',
    );

    writeFileSync(
      path.join(directory, "contract.ts"),
      'import { z } from "zod"; export const InputSchema = z.object({ name: z.string() }); export interface Input { name: string; }',
    );

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/oxlint/bin/oxlint",
        "--config",
        ".oxlintrc.json",
        "--format",
        "json",
        path.join(directory, "legacy.ts"),
        path.join(routeDirectory, "get.ts"),
        path.join(directory, "contract.ts"),
        buildFilename,
      ],
      { encoding: "utf8", timeout: 30_000, cwd: directory },
    );

    assert.equal(result.status, 1, result.stderr);

    const report = JSON.parse(result.stdout);

    assert.ok(
      report.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "factory(require-named-complex-conditions)" &&
          diagnostic.filename.endsWith("scripts/build/invalid-build.ts"),
      ),
      result.stdout,
    );

    for (const rule of [
      "canonical-contract-imports",
      "no-untyped-api-routes",
      "require-schema-derived-contracts",
    ]) {
      assert.ok(
        report.diagnostics.some((diagnostic) => diagnostic.code === `factory(${rule})`),
        result.stdout,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
