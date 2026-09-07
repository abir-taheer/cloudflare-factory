import { noIgnoredCauseCallback } from "../../rules/effect/no_ignored_cause_callback.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-ignored-cause-callback", noIgnoredCauseCallback, {
  valid: [
    'effect.pipe(Effect.tapDefect((cause) => Effect.logError("defect", cause)));',
    'effect.pipe(Effect.catchCause((cause) => Effect.logError("failed", cause)));',
    'effect.pipe(Effect.onError((cause) => Effect.logError("failed", cause)));',
    'Effect.catchCause(effect, (cause) => Effect.logError("failed", cause));',
    "effect.pipe(Effect.tapCause(() => cancelStream()));",
    "effect.pipe(Effect.onInterrupt(() => cancelStream()));",
    "effect.pipe(Effect.tapDefect(handleDefect));",
    "Effect.tapDefect(effect, handleDefect);",
  ],
  invalid: [
    {
      code: 'effect.pipe(Effect.tapDefect(() => Effect.logError("defect")));',
      errors: [{ messageId: "acceptCause" }],
    },
    {
      code: 'effect.pipe(Effect.catchCause(() => Effect.succeed("recovered")));',
      errors: [{ messageId: "acceptCause" }],
    },
    {
      code: 'effect.pipe(Effect.onError(function () { return Effect.logError("failed"); }));',
      errors: [{ messageId: "acceptCause" }],
    },
    {
      code: 'Effect.catchCause(effect, () => Effect.succeed("recovered"));',
      errors: [{ messageId: "acceptCause" }],
    },
    {
      code: 'effect.pipe(Effect.tapDefect((cause) => Effect.logError("defect")));',
      errors: [{ messageId: "useCause" }],
    },
    {
      code: 'Effect.onError(effect, (cause) => Effect.logError("failed"));',
      errors: [{ messageId: "useCause" }],
    },
  ],
});
