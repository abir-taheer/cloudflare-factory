import { noComplexTernary } from "../../rules/quality/no-complex-ternary.mjs";
import { noDbMocks } from "../../rules/testing/no-db-mocks.mjs";
import { noErrorMessageExpectations } from "../../rules/testing/no-error-message-expectations.mjs";
import { noInlineGenericObjectTypes } from "../../rules/quality/no-inline-generic-object-types.mjs";
import { noTypeCasts } from "../../rules/quality/no-type-casts.mjs";
import { noUnnecessarySpread } from "../../rules/quality/no-unnecessary-spread.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-complex-ternary", noComplexTernary, {
  valid: [
    "const selected = ready ? value : fallback;",
    "const result = ready ? call(value) : undefined;",
  ],
  invalid: [
    {
      code: "const result = ready ? search(load({ limit: 1 })) : undefined;",
      errors: [{ messageId: "noComplexTernary" }],
    },
    {
      code: "const result = ready ? new Map() : undefined;",
      errors: [{ messageId: "noComplexTernary" }],
    },
    {
      code: "const result = ready\n ? value\n : (\n fallback\n );",
      errors: [{ messageId: "tooManyLines" }],
    },
  ],
});

ruleTester.run("no-db-mocks", noDbMocks, {
  valid: [
    {
      filename: "database.test.ts",
      code: 'import { Pool } from "pg"; const pool = new Pool(); await pool.query("SELECT 1");',
    },
    {
      filename: "database.test.ts",
      code: 'import { Pool } from "pg"; function inspect(Pool) { vi.spyOn(Pool, "connect"); }',
    },
    { filename: "database.test.ts", code: 'vi.mock("logger", () => ({}));' },
  ],
  invalid: [
    {
      filename: "database.test.ts",
      code: 'vi.mock("pg", () => ({}));',
      errors: [{ messageId: "moduleMock" }],
    },
    {
      filename: "database.test.ts",
      code: 'vi.mock(import("drizzle-orm/node-postgres"), () => ({}));',
      errors: [{ messageId: "moduleMock" }],
    },
    {
      filename: "database.test.ts",
      code: 'import { Pool } from "pg"; const pool = new Pool(); vi.spyOn(pool, "query");',
      errors: [{ messageId: "propertyMock" }],
    },
    {
      filename: "database.test.ts",
      code: 'import { drizzle } from "drizzle-orm/node-postgres"; const database = drizzle(client); database.select = vi.fn();',
      errors: [{ messageId: "assignmentMock" }],
    },
    {
      filename: "database.test.ts",
      code: 'import { mock } from "node:test"; mock.module("redis", {});',
      errors: [{ messageId: "moduleMock" }],
    },
  ],
});

ruleTester.run("no-unnecessary-spread", noUnnecessarySpread, {
  valid: [
    "const result = { ...extras };",
    "const result = { ...(enabled ? buildExtras() : {}) };",
    "const result = { flag: true, ...(enabled ? { flag: false } : {}) };",
    "const result = { ...extras, ...(enabled ? { flag: false } : {}) };",
    "const result = { ...(enabled ? { __proto__ } : {}) };",
    "const result = { ...{ get flag() { return true; } } };",
    "const result = { ...{ run() { return super.run(); } } };",
    "const result = { ...{ __proto__: base } };",
    "const result = [...[, , 'third']];",
  ],
  invalid: [
    {
      code: "const result = { ...(enabled ? { flag: true } : {}) };",
      errors: [{ messageId: "conditionalSpread" }],
    },
    {
      code: "const result = { ...(enabled && { flag: true }) };",
      errors: [{ messageId: "conditionalSpread" }],
    },
    { code: "const result = { ...(extras ?? {}) };", errors: [{ messageId: "redundantFallback" }] },
    {
      code: "const result = { ...{ flag: true } };",
      errors: [{ messageId: "objectLiteralSpread" }],
    },
    {
      code: "const result = { ...{ __proto__ } };",
      errors: [{ messageId: "objectLiteralSpread" }],
    },
    { code: "const result = [...['first']];", errors: [{ messageId: "arrayLiteralSpread" }] },
  ],
});

ruleTester.run("no-type-casts", noTypeCasts, {
  valid: ["const value = { ok: true } as const;", "const value = input satisfies Payload;"],
  invalid: [
    { code: "const value = input as Payload;", errors: [{ messageId: "noCast" }] },
    { code: "let value!: Payload;", errors: [{ messageId: "noNonNull" }] },
    { code: "class Store { accessor value!: string; }", errors: [{ messageId: "noNonNull" }] },
  ],
});

ruleTester.run("no-inline-generic-object-types", noInlineGenericObjectTypes, {
  valid: ["type Payload = { id: string };", "const value = input satisfies Payload;"],
  invalid: [
    {
      code: "const value = input satisfies { id: string };",
      errors: [{ messageId: "nameTheType" }],
    },
    { code: "const value = load<{ id: string }>();", errors: [{ messageId: "nameTheType" }] },
  ],
});

ruleTester.run("no-error-message-expectations", noErrorMessageExpectations, {
  valid: ["expect(error.code).toBe('NOT_FOUND');", "expect(error.message).toBeDefined();"],
  invalid: [
    { code: "expect(error.message).toBe('wording');", errors: [{ messageId: "assertStructure" }] },
    {
      code: "assert.deepEqual(error, { message: 'wording' });",
      errors: [{ messageId: "assertStructure" }],
    },
  ],
});
