import { pinnedDependencyVersions } from "../../rules/testing/pinned-dependency-versions.mjs";
import { createJsonRuleTester } from "../testing.mjs";

const ruleTester = createJsonRuleTester();

ruleTester.run("pinned-dependency-versions", pinnedDependencyVersions, {
  valid: [
    {
      code: '{ "dependencies": { "effect": "3.21.2", "zod": "4.4.3" } }',
      filename: "package.json",
    },
    {
      code: '{ "engines": { "node": ">=24.0.0 <25" } }',
      filename: "package.json",
    },
    {
      code: '{ "pnpm": { "overrides": { "undici": "7.28.0" } } }',
      filename: "package.json",
    },
    {
      code: '{ "devDependencies": { "typescript": "6.0.3-beta" } }',
      filename: "package.json",
    },
    {
      code: '{ "devDependencies": { "@typescript/native": "npm:typescript@7.0.2" } }',
      filename: "package.json",
    },
    {
      code: '{ "devDependencies": { "tsgo": "npm:@effect/tsgo@0.36.0" } }',
      filename: "package.json",
    },
  ],
  invalid: [
    {
      code: '{ "dependencies": { "hono": "^4.12.25" } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
    {
      code: '{ "devDependencies": { "typescript": "~6.0.3" } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
    {
      code: '{ "pnpm": { "overrides": { "ws": ">=8" } } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
    {
      code: '{ "dependencies": { "left-pad": "*" } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
    {
      code: '{ "devDependencies": { "@typescript/native": "npm:typescript@^7.0.2" } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
    {
      code: '{ "devDependencies": { "@typescript/native": "npm:typescript" } }',
      filename: "package.json",
      errors: [{ messageId: "pinExact" }],
    },
  ],
});
