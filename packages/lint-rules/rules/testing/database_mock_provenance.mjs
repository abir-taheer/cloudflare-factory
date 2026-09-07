const DATABASE_EXPRESSION_WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const DATABASE_MODULES = new Set(["@factory/platform", "@prisma/client", "pg", "redis", "ioredis"]);

/** Reads literal module names, including Vitest's import-expression form. */
export function getDatabaseMockSource(node) {
  if (node?.type === "ImportExpression") {
    return getDatabaseMockSource(node.source);
  }

  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }

  return null;
}

/** Covers driver modules and the repository's real database adapters. */
export function isDatabaseMockModule(source) {
  return (
    DATABASE_MODULES.has(source) ||
    source.startsWith("drizzle-orm") ||
    /(?:^|\/)(?:postgres-database|hyperdrive-database|redis-capabilities|dbUtils?|db_utils)(?:\.|\/|$)/u.test(
      source,
    ) ||
    /\/external\/(?:prisma|redis)(?:\.[^/]*)?$/u.test(source)
  );
}

/** Resolves a lexical binding so shadowed mocks do not inherit imported database provenance. */
export function findDatabaseMockBinding(identifier, node, context) {
  let scope = context.sourceCode.getScope(node);

  while (scope !== null) {
    const variable = scope.variables.find((entry) => entry.name === identifier);

    if (variable !== undefined) {
      return variable;
    }

    scope = scope.upper;
  }
}

/** Reduces a property/typed expression to the binding actually being replaced. */
export function getDatabaseMockRoot(node) {
  let current = node;

  while (current) {
    if (current.type === "MemberExpression") {
      current = current.object;
    } else if (DATABASE_EXPRESSION_WRAPPERS.has(current.type)) {
      current = current.expression;
    } else {
      return current.type === "Identifier" ? current : null;
    }
  }

  return null;
}

/** Follows imported drivers and locally constructed Pool/Drizzle clients; never guesses from names. */
export function isDatabaseMockTarget(node, context, seen = new Set()) {
  const root = getDatabaseMockRoot(node);

  if (root === null) {
    return false;
  }

  const variable = findDatabaseMockBinding(root.name, root, context);

  if (variable === undefined || seen.has(variable)) {
    return false;
  }

  seen.add(variable);

  return variable.defs.some((definition) => {
    if (definition.type === "ImportBinding") {
      const source = definition.parent.source.value;
      const imported = definition.node.imported?.name ?? definition.node.local.name;

      if (definition.parent.importKind === "type" || definition.node.importKind === "type") {
        return false;
      }

      return (
        isDatabaseMockModule(source) && (source !== "@factory/platform" || imported === "Database")
      );
    }

    const initializer = definition.node.init;

    if (initializer?.type === "NewExpression" || initializer?.type === "CallExpression") {
      return isDatabaseMockTarget(initializer.callee, context, seen);
    }

    return false;
  });
}
