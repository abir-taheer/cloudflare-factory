/** Disallow spreads that contribute nothing on changed lines. */

const TYPE_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const MAX_REPORTED_KEYS = 3;

/** Strips parentheses and type-only wrappers that never change the value. */
function unwrap(node) {
  let current = node;

  while (current && TYPE_WRAPPERS.has(current.type)) {
    current = current.expression ?? current.typeAnnotation ?? null;
  }

  return current;
}

function isObjectLiteral(node) {
  return node?.type === "ObjectExpression";
}

/** `{}`, `undefined`, and `null` all spread into nothing. */
function isEmptyBranch(node) {
  if (!node) {
    return false;
  }

  if (isObjectLiteral(node)) {
    return node.properties.length === 0;
  }

  if (node.type === "Identifier") {
    return node.name === "undefined";
  }

  return (node.type === "Literal" || node.type === "NullLiteral") && node.value === null;
}

/** The statically-written name of a key, or null when it isn't written out. */
function staticKeyName(property) {
  if (property.computed) {
    return null;
  }

  const key = property.key;

  if (key.type === "Identifier") {
    return key.name;
  }

  if (key.type === "Literal" || key.type === "StringLiteral") {
    return String(key.value);
  }

  return null;
}

function hasProtoName(property) {
  return staticKeyName(property) === "__proto__";
}

/** Only the `__proto__: value` form sets the prototype instead of adding an own property; shorthand and methods make an ordinary own property. */
function isProtoSetterKey(property) {
  return hasProtoName(property) && !property.shorthand && !property.method;
}

/** Spreading an object literal reads its accessors and copies the resulting values; writing the same properties inline keeps them as accessors. */
function isInlinableObjectLiteral(node) {
  return node.properties.every(
    (property) =>
      property.type !== "Property" ||
      (property.kind === "init" && !property.method && !isProtoSetterKey(property)),
  );
}

/** An object literal is mechanically rewritable when every key is written out. */
function isRewritableObjectLiteral(node) {
  return (
    isObjectLiteral(node) &&
    node.properties.length > 0 &&
    node.properties.every(
      (property) =>
        property.type === "Property" &&
        property.kind === "init" &&
        !property.computed &&
        !property.method &&
        !hasProtoName(property),
    )
  );
}

function keyNames(node) {
  return node.properties.map((property) => staticKeyName(property) ?? "…");
}

/** A conditional spread leaves whatever came before it untouched when the condition is false; the suggested plain property overwrites it with `undefined`. */
function overwritesEarlierKey(objectExpression, spreadNode, names) {
  if (!Array.isArray(objectExpression?.properties)) {
    return false;
  }

  const wanted = new Set(names);

  for (const property of objectExpression.properties) {
    if (property === spreadNode) {
      return false;
    }

    if (property.type !== "Property") {
      return true;
    }

    const name = staticKeyName(property);

    if (name === null || wanted.has(name)) {
      return true;
    }
  }

  return false;
}

/** Renders keys for a message that already wraps the value in backticks. */
function describeKeys(names) {
  const separator = "`, `";
  const shown = names.slice(0, MAX_REPORTED_KEYS).join(separator);

  if (names.length > MAX_REPORTED_KEYS) {
    return `${shown + separator}…`;
  }

  return shown;
}

/** Returns the object literal a conditional spread would contribute, when the other branch contributes nothing. */
function conditionalObjectLiteral(expression) {
  if (expression.type === "ConditionalExpression") {
    const consequent = unwrap(expression.consequent);
    const alternate = unwrap(expression.alternate);

    if (isEmptyBranch(alternate) && isRewritableObjectLiteral(consequent)) {
      return consequent;
    }

    if (isEmptyBranch(consequent) && isRewritableObjectLiteral(alternate)) {
      return alternate;
    }

    return null;
  }

  // Only `&&` has the conditional-object shape. In `left || { key: value }` a truthy
  // `left` is spread instead, and its key set isn't statically known.
  if (expression.type === "LogicalExpression" && expression.operator === "&&") {
    const right = unwrap(expression.right);
    return isRewritableObjectLiteral(right) ? right : null;
  }

  return null;
}

export const noUnnecessarySpread = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow conditional and literal spreads that could be written as plain properties or elements",
      category: "Maintainability",
      recommended: true,
    },
    messages: {
      conditionalSpread:
        "Conditional spread hides `{{keys}}` behind control flow. Build the conditional object in a named variable; preserve absent keys instead of adding undefined.",
      conditionalSpreadMultipleKeys:
        "Conditional spread hides `{{keys}}` behind control flow. Write each one as a normal property with a conditional value, or build the branch into a named variable above the literal.",
      redundantFallback:
        "Spreading `null` or `undefined` already contributes no properties, so the `{{operator}} {}` fallback is dead. Spread the value directly.",
      objectLiteralSpread:
        "Spreading an object literal into an object literal. Write its properties inline.",
      arrayLiteralSpread: "Spreading an array literal. Write its elements inline.",
    },
    schema: [],
  },
  create(context) {
    function reportConditionalSpread(node, expression) {
      const literal = conditionalObjectLiteral(expression);

      if (!literal) {
        return false;
      }

      const names = keyNames(literal);

      if (overwritesEarlierKey(node.parent, node, names)) {
        return false;
      }

      context.report({
        node,
        messageId: names.length === 1 ? "conditionalSpread" : "conditionalSpreadMultipleKeys",
        data: { keys: describeKeys(names) },
      });

      return true;
    }

    function reportRedundantFallback(node, expression) {
      const isNullishFallback =
        expression.type === "LogicalExpression" &&
        (expression.operator === "??" || expression.operator === "||") &&
        isEmptyBranch(unwrap(expression.right));

      const isTernaryFallback =
        expression.type === "ConditionalExpression" &&
        isEmptyBranch(unwrap(expression.alternate)) &&
        isEmptyBranch(unwrap(expression.consequent));

      if (!isNullishFallback && !isTernaryFallback) {
        return false;
      }

      context.report({
        node,
        messageId: "redundantFallback",
        data: { operator: isNullishFallback ? expression.operator : "?" },
      });

      return true;
    }

    function checkObjectSpread(node) {
      const argument = unwrap(node.argument);

      if (!argument) {
        return;
      }

      if (isObjectLiteral(argument)) {
        if (isInlinableObjectLiteral(argument)) {
          context.report({ node, messageId: "objectLiteralSpread" });
        }

        return;
      }

      if (reportRedundantFallback(node, argument)) {
        return;
      }

      reportConditionalSpread(node, argument);
    }

    function checkIterableSpread(node) {
      const argument = unwrap(node.argument);

      if (argument?.type !== "ArrayExpression") {
        return;
      }

      // Spreading turns a hole into an explicit `undefined`, so `[...[, ,]]` and
      // `[, ,]` are different arrays. Estree writes a hole as a null element.
      const hasHole = argument.elements.some((element) => element === null);

      if (hasHole) {
        return;
      }

      context.report({ node, messageId: "arrayLiteralSpread" });
    }

    return {
      SpreadElement(node) {
        if (node.parent?.type === "ObjectExpression") {
          checkObjectSpread(node);
          return;
        }

        checkIterableSpread(node);
      },
      // Older estree shapes still emit object rest/spread as its own node type.
      ExperimentalSpreadProperty: checkObjectSpread,
    };
  },
};
