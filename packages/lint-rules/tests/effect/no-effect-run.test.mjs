import { noEffectRun } from "../../rules/effect/no-effect-run.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-effect-run", noEffectRun, {
  valid: [
    "function loadDocument() { return unpackDocx(bytes); }",
    "const response = runtime.runPromise(program);",
    "const composed = effect.pipe(Effect.map((value) => value.id));",
  ],
  invalid: [
    { code: "Effect.runPromiseWith(context);", errors: [{ messageId: "boundaryOnly" }] },
    {
      code: "const services = Effect.runSync(loadServices);",
      errors: [{ messageId: "boundaryOnly" }],
    },
    {
      code: "const result = await Effect.runPromise(program);",
      errors: [{ messageId: "boundaryOnly" }],
    },
    {
      code: "const result = program.pipe(Effect.result, Effect.runPromise);",
      errors: [{ messageId: "boundaryOnly" }],
    },
  ],
});
