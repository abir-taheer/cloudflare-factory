import { Linter } from "eslint";

const eslintStyleLinter = new Linter({ configType: "eslintrc" });
const eslintStyleRules = eslintStyleLinter.getRules();

/** Supplies real ESLint style visitors that are not implemented natively by Oxlint. */
export const nativeStyleLintRules = {
  "brace-style": eslintStyleRules.get("brace-style"),
  "max-statements-per-line": eslintStyleRules.get("max-statements-per-line"),
};
