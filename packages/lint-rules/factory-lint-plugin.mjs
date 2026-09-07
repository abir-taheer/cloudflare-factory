import { nativeStyleLintRules } from "./native-style-lint-rules.mjs";
import { apiContractLintRules } from "./api-contract-lint-rules.mjs";
import { effectSafetyLintRules } from "./effect-safety-lint-rules.mjs";
import { codeReadabilityLintRules } from "./code-readability-lint-rules.mjs";
import { typeAndTestLintRules } from "./type-and-test-lint-rules.mjs";

/** Enforces shared contracts through Oxlint's supported JavaScript plugin API. */
const factoryLintPlugin = {
  meta: { name: "factory" },
  rules: {
    ...nativeStyleLintRules,
    ...apiContractLintRules,
    ...effectSafetyLintRules,
    ...codeReadabilityLintRules,
    ...typeAndTestLintRules,
  },
};

export default factoryLintPlugin;
