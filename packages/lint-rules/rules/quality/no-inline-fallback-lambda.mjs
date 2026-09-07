// Readability: never combine a fallback operator with an inline lambda
// (options.fetch ?? (() => ...)); bind the fallback to a named const.

/** Enforces no inline fallback lambda through ESLint-compatible AST visitors. */
export const noInlineFallbackLambda = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow function definitions as the right side of ?? or ||; bind the fallback to a named const",
    },
    schema: [],
    messages: {
      nameTheFallback:
        "A fallback operator combined with an inline function definition is two things to parse in one glance. Bind the fallback function to a named const above this use.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "??" && node.operator !== "||") {
          return;
        }

        if (
          node.right.type === "ArrowFunctionExpression" ||
          node.right.type === "FunctionExpression"
        ) {
          context.report({ node: node.right, messageId: "nameTheFallback" });
        }
      },
    };
  },
};
