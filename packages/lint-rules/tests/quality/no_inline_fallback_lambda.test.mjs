import { noInlineFallbackLambda } from "../../rules/quality/no_inline_fallback_lambda.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-inline-fallback-lambda", noInlineFallbackLambda, {
  valid: [
    "const fetchImpl = options.fetch ?? rejectUnstubbedFetch;",
    "const port = options.port ?? 3000;",
    "const handlers = { onError: () => retry() };",
    "const chosen = primary || secondary;",
  ],
  invalid: [
    {
      code: 'const fetchImpl = options.fetch ?? (() => Promise.reject(new Error("no fetch stubbed")));',
      errors: [{ messageId: "nameTheFallback" }],
    },
    {
      code: "const callback = provided || function fallback() { return null; };",
      errors: [{ messageId: "nameTheFallback" }],
    },
  ],
});
