import { RuleTester as JsonRuleTester } from "eslint";
import * as jsoncParser from "jsonc-eslint-parser";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
JsonRuleTester.describe = describe;
JsonRuleTester.it = it;
JsonRuleTester.itOnly = it.only;

/** Creates a TypeScript snippet tester using the same parser as repository lint. */
export function createTypescriptRuleTester() {
  return new RuleTester({
    languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } },
  });
}

/** JSON rules use ESLint because Oxlint does not run jsonc parser visitors. */
export function createJsonRuleTester() {
  return new JsonRuleTester({ languageOptions: { parser: jsoncParser } });
}
