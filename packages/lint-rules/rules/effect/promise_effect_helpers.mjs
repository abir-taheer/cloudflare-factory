/** Identifies an imported Effect namespace, including lexical shadowing checks. */
export function isImportedEffectCall(node, context) {
  if (
    node.callee.type !== "MemberExpression" ||
    node.callee.object.type !== "Identifier" ||
    node.callee.object.name !== "Effect"
  ) {
    return false;
  }

  let scope = context.sourceCode.getScope(node);

  while (scope !== null) {
    const variable = scope.variables.find((entry) => entry.name === "Effect");

    if (variable !== undefined) {
      return variable.defs.some(
        (definition) =>
          definition.type === "ImportBinding" &&
          ["effect", "effect/Effect"].includes(definition.parent.source.value),
      );
    }

    scope = scope.upper;
  }

  return false;
}

/** Matches the native Promise rules' awaited or yielded ancestor exception. */
export function hasAwaitedPromiseAncestor(node) {
  let ancestor = node.parent;

  while (ancestor) {
    if (ancestor.type === "AwaitExpression" || ancestor.type === "YieldExpression") {
      return true;
    }

    ancestor = ancestor.parent;
  }

  return false;
}

/** Reads a statically named method, including computed string properties. */
export function getPromiseMethodName(callee) {
  if (callee.type !== "MemberExpression") {
    return;
  }

  return callee.computed ? callee.property.value : callee.property.name;
}
