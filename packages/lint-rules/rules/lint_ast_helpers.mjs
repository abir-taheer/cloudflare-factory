// Shared AST helpers for walking fluent call chains like z.object({...}).openapi({...}).

/** Finds the root symbol of a fluent call chain without following runtime values. */
export function getFluentCallRoot(node) {
  let current = node;

  while (current) {
    if (current.type === "CallExpression") {
      current = current.callee;
      continue;
    }

    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }

    if (current.type === "ChainExpression" || current.type === "TSNonNullExpression") {
      current = current.expression;
      continue;
    }

    return current;
  }

  return null;
}

/** Recognizes schema construction rooted at the canonical Zod import. */
export function isZodRootedCall(node) {
  if (node.type !== "CallExpression") {
    return false;
  }

  const root = getFluentCallRoot(node);
  return root !== null && root.type === "Identifier" && root.name === "z";
}

/** Matches canonical Effect members against a rule-specific method set. */
export function isEffectApiMember(node, methodNames) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "Effect" &&
    node.property.type === "Identifier" &&
    methodNames.has(node.property.name)
  );
}

function nodeIdentity(node) {
  if (Array.isArray(node.range)) {
    return `${node.type}:${node.range[0]}:${node.range[1]}`;
  }

  return node;
}

function walkWithSeen(node, visit, seen) {
  if (node === null || typeof node !== "object" || typeof node.type !== "string") {
    return;
  }

  const identity = nodeIdentity(node);

  if (seen.has(identity)) {
    return;
  }

  seen.add(identity);

  if (visit(node) === false) {
    return;
  }

  for (const key of Object.keys(node)) {
    if (key === "parent") {
      continue;
    }

    const value = node[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        walkWithSeen(item, visit, seen);
      }

      continue;
    }

    walkWithSeen(value, visit, seen);
  }
}

// Generic AST walkLintAst; return false from visit to skip a node's children.
// Shorthand properties expose one Identifier twice, so nodes are deduped by type and range.
/** Walks lint AST children once, excluding cyclic parent links. */
export function walkLintAst(node, visit) {
  walkWithSeen(node, visit, new Set());
}
