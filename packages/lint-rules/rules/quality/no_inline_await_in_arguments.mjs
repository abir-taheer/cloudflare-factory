// Readability: hoist awaited values to a named const; never write fn(await x).

/** Enforces no inline await in arguments through ESLint-compatible AST visitors. */
export const noInlineAwaitInArguments = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow await expressions inside call or constructor arguments; hoist the awaited value to a named const first",
    },
    schema: [],
    messages: {
      hoistAwait:
        "Do not await inline inside an argument. Hoist the awaited value to a named const above the call.",
    },
  },
  create(context) {
    return {
      AwaitExpression(node) {
        let child = node;
        let parent = node.parent;

        while (parent) {
          if (
            parent.type === "ArrowFunctionExpression" ||
            parent.type === "FunctionExpression" ||
            parent.type === "FunctionDeclaration"
          ) {
            return;
          }

          if (
            (parent.type === "CallExpression" || parent.type === "NewExpression") &&
            parent.arguments.includes(child)
          ) {
            context.report({ node, messageId: "hoistAwait" });
            return;
          }

          child = parent;
          parent = parent.parent;
        }
      },
    };
  },
};
