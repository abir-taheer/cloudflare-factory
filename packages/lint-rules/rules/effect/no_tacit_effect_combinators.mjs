// Shared Effect rules: no tacit calls like Effect.map(fn); explicit lambdas
// preserve inference, overload behavior, and stack traces.

import { isEffectApiMember } from "../lint_ast_helpers.mjs";

const FUNCTION_TAKING_COMBINATORS = new Set([
  "catch",
  "catchCause",
  "flatMap",
  "map",
  "mapError",
  "tap",
  "tapDefect",
  "tapError",
  "tapCause",
]);

/** Enforces no tacit effect combinators through ESLint-compatible AST visitors. */
export const noTacitEffectCombinators = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow passing bare function references to Effect combinators like Effect.map(fn); use an explicit lambda",
    },
    schema: [],
    messages: {
      useExplicitLambda:
        "Avoid tacit usage: pass an explicit lambda such as Effect.{{method}}((value) => {{callback}}(value)) instead of Effect.{{method}}({{callback}}).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectApiMember(node.callee, FUNCTION_TAKING_COMBINATORS)) {
          return;
        }

        if (node.arguments.length === 0) {
          return;
        }

        const callbackArgument = node.arguments.at(-1);

        if (
          callbackArgument.type !== "Identifier" &&
          callbackArgument.type !== "MemberExpression"
        ) {
          return;
        }

        context.report({
          node: callbackArgument,
          messageId: "useExplicitLambda",
          data: {
            method: node.callee.property.name,
            callback: context.sourceCode.getText(callbackArgument),
          },
        });
      },
    };
  },
};
