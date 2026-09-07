import { noTacitEffectCombinators } from "../../rules/effect/no-tacit-effect-combinators.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-tacit-effect-combinators", noTacitEffectCombinators, {
  valid: [
    "const mapped = source.pipe(Effect.map((value) => transform(value)));",
    "const mapped = Effect.map(source, (value) => transform(value));",
    "const names = items.map(pluckName);",
    "const chained = source.pipe(Effect.flatMap((raw) => importDek(raw)));",
  ],
  invalid: [
    {
      code: "const chained = source.pipe(Effect.flatMap(importDek));",
      errors: [{ messageId: "useExplicitLambda" }],
    },
    {
      code: "const mapped = Effect.map(source, transform);",
      errors: [{ messageId: "useExplicitLambda" }],
    },
    {
      code: "const recovered = source.pipe(Effect.catch(handleFailure));",
      errors: [{ messageId: "useExplicitLambda" }],
    },
  ],
});
