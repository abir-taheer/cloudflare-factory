// Adapted from Keyring: name a function retrieved or constructed by a call
// before invoking it, so both operations remain easy to scan.

function unwrapInstantiationExpression(node) {
  if (node.type === "TSInstantiationExpression") {
    return node.expression;
  }

  return node;
}

function isEffectFactoryCall(node) {
  const factory = unwrapInstantiationExpression(node.callee);

  if (factory.type !== "MemberExpression" || factory.computed) {
    return false;
  }

  const object = factory.object;
  const property = factory.property;

  return (
    object.type === "Identifier" &&
    property.type === "Identifier" &&
    ((object.name === "Effect" && property.name === "fn") ||
      (object.name === "Context" && property.name === "Service"))
  );
}

function getReturnedFunctionCall(callee) {
  const returnedFunction = unwrapInstantiationExpression(callee);

  if (returnedFunction.type === "CallExpression") {
    return returnedFunction;
  }
}

function isParameterizedTestFactory(node) {
  const factory = unwrapInstantiationExpression(node.callee);

  return (
    factory.type === "MemberExpression" &&
    !factory.computed &&
    factory.object.type === "Identifier" &&
    ["describe", "it", "test"].includes(factory.object.name) &&
    factory.property.type === "Identifier" &&
    factory.property.name === "each"
  );
}

/** Enforces no immediate returned function call through ESLint-compatible AST visitors. */
export const noImmediateReturnedFunctionCall = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow immediately invoking a function returned by another call; bind it to a named const first",
    },
    schema: [],
    messages: {
      nameReturnedFunction:
        "Do not immediately invoke a function returned by another call. Bind it to a named const before calling it.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const returnedFunctionCall = getReturnedFunctionCall(node.callee);

        if (
          returnedFunctionCall === undefined ||
          isEffectFactoryCall(returnedFunctionCall) ||
          isParameterizedTestFactory(returnedFunctionCall)
        ) {
          return;
        }

        context.report({ node: returnedFunctionCall, messageId: "nameReturnedFunction" });
      },
    };
  },
};
