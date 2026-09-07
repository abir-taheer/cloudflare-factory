import { noTryInEffectCallback } from "../../rules/effect/no-try-in-effect-callback.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-try-in-effect-callback", noTryInEffectCallback, {
  valid: [
    "function parseOrNull(raw) { try { return JSON.parse(raw); } catch { return null; } }",
    "const results = items.map(() => { try { return risky(); } catch { return null; } });",
    "const wrapped = Effect.try({ try: () => JSON.parse(raw), catch: () => new ParseError() });",
  ],
  invalid: [
    {
      code: "const program = Effect.gen(function* () { try { yield* step(); } catch { } });",
      errors: [{ messageId: "useEffectTry" }],
    },
    {
      code: 'const traced = Effect.fn("traced")(function* (input) { try { work(input); } catch { } });',
      errors: [{ messageId: "useEffectTry" }],
    },
    {
      code: "const mapped = source.pipe(Effect.map((value) => { try { return decode(value); } catch { return value; } }));",
      errors: [{ messageId: "useEffectTry" }],
    },
  ],
});
