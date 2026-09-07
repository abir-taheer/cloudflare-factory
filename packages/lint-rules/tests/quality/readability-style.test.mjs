import { nativeStyleLintRules } from "../../native-style-lint-rules.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("brace-style", nativeStyleLintRules["brace-style"], {
  valid: [
    { code: "if (ready) {\n  returnValue();\n}", options: ["1tbs", { allowSingleLine: false }] },
  ],
  invalid: [
    {
      code: "if (ready) { returnValue(); }",
      options: ["1tbs", { allowSingleLine: false }],
      errors: 2,
      output: "if (ready) {\n returnValue(); \n}",
    },
  ],
});

ruleTester.run("max-statements-per-line", nativeStyleLintRules["max-statements-per-line"], {
  valid: ["first();\nsecond();"],
  invalid: [{ code: "first(); second();", errors: 1 }],
});
