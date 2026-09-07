// Memory feedback-tests-behavior-only: tests assert on _tag and structure, not
// message strings. Flags assert.*(...) arguments reading .message or .reason.

import { walkLintAst } from "../lint_ast_helpers.mjs";

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const MESSAGE_PROPERTY_NAMES = new Set(["message", "reason"]);

function isAssertCall(node) {
  if (node.callee.type === "Identifier" && node.callee.name === "assert") {
    return true;
  }

  return (
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "assert"
  );
}

export const noErrorMessageAssertions = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Discourage asserting on error .message/.reason strings in tests; assert on _tag and structure instead (memory feedback-tests-behavior-only)",
    },
    schema: [],
    messages: {
      assertOnTag:
        "Assert on the error's _tag and structure, not its .{{property}} string. Message wording can change without changing behavior.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isAssertCall(node)) {
          return;
        }

        for (const argument of node.arguments) {
          walkLintAst(argument, (candidate) => {
            if (FUNCTION_TYPES.has(candidate.type)) {
              return false;
            }

            if (
              candidate.type === "MemberExpression" &&
              !candidate.computed &&
              candidate.property.type === "Identifier" &&
              MESSAGE_PROPERTY_NAMES.has(candidate.property.name)
            ) {
              context.report({
                node: candidate.property,
                messageId: "assertOnTag",
                data: { property: candidate.property.name },
              });
            }

            return true;
          });
        }
      },
    };
  },
};
