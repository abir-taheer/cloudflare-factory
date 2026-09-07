import { noEffectSchema } from "../../rules/api/no_effect_schema.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-effect-schema", noEffectSchema, {
  valid: ['import { Effect, Context } from "effect";', 'import { z } from "zod";'],
  invalid: [
    { code: 'import { Schema as Validation } from "effect";', errors: [{ messageId: "useZod" }] },
    { code: 'import * as Schema from "effect/Schema";', errors: [{ messageId: "useZod" }] },
    { code: 'export { Schema } from "effect";', errors: [{ messageId: "useZod" }] },
    { code: 'export * from "effect/SchemaAST";', errors: [{ messageId: "useZod" }] },
    { code: 'const schema = await import("effect/schema");', errors: [{ messageId: "useZod" }] },
    { code: 'Effect["Schema"].String;', errors: [{ messageId: "useZod" }] },
  ],
});
