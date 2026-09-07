import { canonicalContractImports } from "../../rules/api/canonical-contract-imports.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("canonical-contract-imports", canonicalContractImports, {
  valid: [
    'import * as Effect from "effect/Effect";',
    'import type { Effect as EffectType } from "effect";',
    'import { type Effect as EffectType } from "effect/Effect";',
    'import { Effect, Context, Schema } from "effect";',
    'import { z, createRoute, OpenAPIHono } from "@hono/zod-openapi";',
    'import * as z from "zod";',
    'import { get as readValue } from "other-package";',
  ],
  invalid: [
    {
      code: 'import { runPromise } from "effect/Effect";',
      errors: [{ messageId: "canonicalName" }],
    },
    { code: 'import { z as schema } from "zod/v4";', errors: [{ messageId: "canonicalName" }] },
    { code: 'import { Effect as E } from "effect";', errors: [{ messageId: "canonicalName" }] },
    {
      code: 'import { createRoute as route } from "@hono/zod-openapi";',
      errors: [{ messageId: "canonicalName" }],
    },
    { code: 'import * as schema from "zod";', errors: [{ messageId: "canonicalName" }] },
    { code: 'import * as effects from "effect";', errors: [{ messageId: "canonicalName" }] },
  ],
});
