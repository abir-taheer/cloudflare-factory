import parser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const recommendedHooks = reactHooks.configs.flat["recommended-latest"];

/** Keep every official recommended compiler diagnostic enabled, including future preset additions. */
const compilerRules = Object.fromEntries(
  Object.entries(recommendedHooks.rules).map(([name, setting]) => {
    if (Array.isArray(setting)) {
      return [name, ["error", ...setting.slice(1)]];
    }

    return [name, "error"];
  }),
);

/** TypeScript JSX is parsed without a second project type checker; root Oxlint owns type checks. */
const reactHooksLintConfig = [
  {
    ...recommendedHooks,
    files: ["apps/frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      ...compilerRules,
      "react-hooks/hooks": "error",
      "react-hooks/capitalized-calls": "error",
      "react-hooks/memo-dependencies": "error",
      "react-hooks/exhaustive-effect-dependencies": "error",
      "react-hooks/no-deriving-state-in-effects": "error",
      "react-hooks/syntax": "error",
      "react-hooks/rule-suppression": "error",
    },
  },
];

export default reactHooksLintConfig;
