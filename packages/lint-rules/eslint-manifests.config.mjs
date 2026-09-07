import * as jsoncParser from "jsonc-eslint-parser";
import { pinnedDependencyVersions } from "./rules/testing/pinned-dependency-versions.mjs";

/** JSON-only supplemental gate; code files are enforced by strict Oxlint. */
const manifestLintConfig = [
  {
    files: ["**/package.json"],
    languageOptions: { parser: jsoncParser },
    plugins: { factory: { rules: { "pinned-dependency-versions": pinnedDependencyVersions } } },
    rules: { "factory/pinned-dependency-versions": "error" },
  },
];

export default manifestLintConfig;
