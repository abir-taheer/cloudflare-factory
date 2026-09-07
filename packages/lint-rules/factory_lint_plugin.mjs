import { nativeStyleLintRules } from "./native_style_lint_rules.mjs";
import { apiContractLintRules } from "./api_contract_lint_rules.mjs";
import { effectSafetyLintRules } from "./effect_safety_lint_rules.mjs";
import { codeReadabilityLintRules } from "./code_readability_lint_rules.mjs";
import { typeAndTestLintRules } from "./type_and_test_lint_rules.mjs";

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
