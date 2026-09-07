import { noConditionalLogLevel } from "../../rules/effect/no_conditional_log_level.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-conditional-log-level", noConditionalLogLevel, {
  valid: [
    `
      let failureLogLevel = LogLevel.Warning;
      if (status >= 500) {
        failureLogLevel = LogLevel.Error;
      }
      const line = Effect.logWithLevel(failureLogLevel, "request failed");
    `,
    "const value = isLarge ? big : small;",
    'const line = Effect.logError("always an error");',
  ],
  invalid: [
    {
      code: 'const line = status >= 500 ? Effect.logError("failed") : Effect.logWarning("failed");',
      errors: [{ messageId: "useLogWithLevel" }],
    },
    {
      code: '(status >= 500 ? Effect.logError : Effect.logWarning)("failed");',
      errors: [{ messageId: "useLogWithLevel" }],
    },
    {
      code: `
        const line = fatal
          ? Effect.logError("failed").pipe(Effect.annotateLogs("error.status", status))
          : Effect.logWarning("failed");
      `,
      errors: [{ messageId: "useLogWithLevel" }],
    },
  ],
});
