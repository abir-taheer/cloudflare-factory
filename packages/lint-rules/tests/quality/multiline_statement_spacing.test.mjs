import { requireBlankLinesBetweenStatementTypes } from "../../rules/quality/require_blank_lines_between_statement_types.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("multiline-statement-spacing", requireBlankLinesBetweenStatementTypes, {
  valid: [
    "const first = 1;\nconst second = 2;",
    'import {\n  first,\n} from "first";\nimport { second } from "second";',
    "Effect.gen(function* () {\n  const runtime = yield* Effect.acquireRelease(\n    acquireRuntime,\n    releaseRuntime,\n  );\n\n  const application = HttpEffect.fromWebHandler(\n    runtime,\n    handler,\n  );\n\n  yield* HttpServer.serve(application);\n});",
  ],
  invalid: [
    {
      code: "const first = setup(\n  options,\n);\nconst second = createApplication(first);",
      errors: [{ messageId: "missingBlankLine" }],
      output: "const first = setup(\n  options,\n);\n\nconst second = createApplication(first);",
    },
    {
      code: "const first = setup(\n  options,\n);\n// Application consumes the runtime.\nconst second = createApplication(first);",
      errors: [{ messageId: "missingBlankLine" }],
      output:
        "const first = setup(\n  options,\n);\n\n// Application consumes the runtime.\nconst second = createApplication(first);",
    },
    {
      code: "Effect.gen(function* () {\n  const runtime = yield* Effect.acquireRelease(\n    acquireRuntime,\n    releaseRuntime,\n  );\n  const application = HttpEffect.fromWebHandler(\n    runtime,\n    handler,\n  );\n  yield* HttpServer.serve(application);\n});",
      errors: [{ messageId: "missingBlankLine" }, { messageId: "missingBlankLine" }],
      output:
        "Effect.gen(function* () {\n  const runtime = yield* Effect.acquireRelease(\n    acquireRuntime,\n    releaseRuntime,\n  );\n\n  const application = HttpEffect.fromWebHandler(\n    runtime,\n    handler,\n  );\n\n  yield* HttpServer.serve(application);\n});",
    },
  ],
});
