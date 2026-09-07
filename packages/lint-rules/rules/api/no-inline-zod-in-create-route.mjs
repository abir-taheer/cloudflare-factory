// Adapted from Keyring: schemas passed to createRoute must be named so the
// HTTP contract can be found, reused, and reviewed independently.

import { isZodRootedCall, walkLintAst } from "../lint-ast-helpers.mjs";

/** Enforces no inline zod in create route through ESLint-compatible AST visitors. */
export const noInlineZodInCreateRoute = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow inline z.* schema construction inside createRoute; extract a named schema first",
    },
    schema: [],
    messages: {
      extractSchema:
        "Do not inline Zod schemas inside createRoute. Extract this into a named schema const above the route definition.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "createRoute") {
          return;
        }

        for (const argument of node.arguments) {
          walkLintAst(argument, (candidate) => {
            if (isZodRootedCall(candidate)) {
              context.report({ node: candidate, messageId: "extractSchema" });
              return false;
            }

            return true;
          });
        }
      },
    };
  },
};
