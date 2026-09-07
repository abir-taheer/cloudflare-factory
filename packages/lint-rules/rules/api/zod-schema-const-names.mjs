// Shared type safety: name Zod schemas after the boundary they validate,
// PascalCase and ending in "Schema" (UploadRequestSchema, ...).

import { getFluentCallRoot } from "../lint-ast-helpers.mjs";

const PARSE_RESULT_METHODS = new Set([
  "decode",
  "encode",
  "parse",
  "parseAsync",
  "safeParse",
  "safeParseAsync",
]);

function returnsParseResult(node) {
  return (
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    PARSE_RESULT_METHODS.has(node.callee.property.name)
  );
}

/** Enforces zod schema const names through ESLint-compatible AST visitors. */
export const zodSchemaConstNames = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        'Require variables holding Zod schemas to be PascalCase and end in "Schema" (Shared type safety)',
    },
    schema: [],
    messages: {
      schemaSuffix:
        'Zod schema "{{name}}" must be named after the boundary it validates and end in "Schema" (e.g. {{suggestion}}).',
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.init === null) {
          return;
        }

        if (node.init.type !== "CallExpression") {
          return;
        }

        const root = getFluentCallRoot(node.init);

        if (root === null || root.type !== "Identifier" || root.name !== "z") {
          return;
        }

        if (returnsParseResult(node.init)) {
          return;
        }

        const name = node.id.name;

        if (/^[A-Z][A-Za-z0-9]*Schema$/u.test(name)) {
          return;
        }

        const stem = name.replace(/Schema$/u, "");
        const suggestion = `${stem.charAt(0).toUpperCase()}${stem.slice(1)}Schema`;

        context.report({
          node: node.id,
          messageId: "schemaSuffix",
          data: { name, suggestion },
        });
      },
    };
  },
};
