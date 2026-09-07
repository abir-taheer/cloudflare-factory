// Shared Effect rules: no try/catch inside Effect code — use
// Effect.try/Effect.tryPromise. Plain non-Effect helpers may still use try/catch.

function isEffectApiCallee(callee) {
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Effect"
  ) {
    return true;
  }

  // Curried forms such as Effect.fn("name")(function* () { ... }).
  if (callee.type === "CallExpression") {
    return isEffectApiCallee(callee.callee);
  }

  return false;
}

/** Enforces no try in effect callback through ESLint-compatible AST visitors. */
export const noTryInEffectCallback = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow try/catch inside callbacks and generators passed to Effect APIs; use Effect.try or Effect.tryPromise",
    },
    schema: [],
    messages: {
      useEffectTry:
        "Do not use try/catch inside Effect code. Wrap the throwing operation with Effect.try (sync) or Effect.tryPromise (async) and map the failure to a typed error.",
    },
  },
  create(context) {
    return {
      TryStatement(node) {
        let parent = node.parent;

        while (parent) {
          const isFunction =
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression" ||
            parent.type === "FunctionDeclaration";

          if (isFunction) {
            const enclosingCall = parent.parent;

            if (
              enclosingCall !== undefined &&
              enclosingCall.type === "CallExpression" &&
              enclosingCall.arguments.includes(parent) &&
              isEffectApiCallee(enclosingCall.callee)
            ) {
              context.report({ node, messageId: "useEffectTry" });
            }

            return;
          }

          parent = parent.parent;
        }
      },
    };
  },
};
