/** Recognizes callbacks directly wrapped by the imported Node Promise adapter. */
export function isPromisifyCallback(node, context) {
  const call = node.parent;

  if (call?.type !== "CallExpression" || call.callee.type !== "Identifier") {
    return false;
  }

  let scope = context.sourceCode.getScope(call);

  while (scope !== null) {
    const variable = scope.variables.find((entry) => entry.name === call.callee.name);

    if (variable !== undefined) {
      return variable.defs.some(
        (definition) =>
          definition.type === "ImportBinding" &&
          definition.parent.source.value === "node:util" &&
          definition.node.imported?.name === "promisify",
      );
    }

    scope = scope.upper;
  }

  return false;
}
