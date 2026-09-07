import { unwrapErrorExpression } from "./error_expression.mjs";

const WORDING_MATCHER_METHODS = new Set(["toMatch", "toContain"]);

const WORDING_ASSERTION_METHODS = new Set([
  "equal",
  "strictEqual",
  "deepEqual",
  "deepStrictEqual",
  "match",
]);

const ASSERTION_ARGUMENT_COUNT = 2;

const INTRINSIC_ERROR_FIELDS = new Set(["error_description", "error_message"]);
const WORDING_FIELDS = new Set(["message"]);

// Presence, type, and shape checks do not couple tests to wording.
const ALLOWED_STRUCTURAL_MATCHERS = new Set([
  "toBeDefined",
  "toBeFalsy",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeInstanceOf",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeNull",
  "toBeTruthy",
  "toBeTypeOf",
  "toBeUndefined",
  "toHaveLength",
]);

function staticString(node) {
  const expression = unwrapErrorExpression(node);

  return expression?.type === "Literal" && typeof expression.value === "string"
    ? expression.value
    : null;
}

function memberName(node) {
  const expression = unwrapErrorExpression(node);

  if (expression?.type !== "MemberExpression") {
    return null;
  }

  return !expression.computed && expression.property.type === "Identifier"
    ? expression.property.name
    : staticString(expression.property);
}

function rootIdentifier(node) {
  let current = unwrapErrorExpression(node);

  while (current?.type === "MemberExpression") {
    current = unwrapErrorExpression(current.object);
  }

  return current?.type === "Identifier" ? current.name : null;
}

function looksLikeErrorIdentifier(name) {
  if (/^(?:mock|spy)/iu.test(name)) {
    return false;
  }

  return (
    /(?:^|_)(?:err|error|exception|failure)s?$/iu.test(name) ||
    /(?:Err|Error|Exception|Failure)s?$/u.test(name)
  );
}

function isObviousErrorValue(node) {
  const expression = unwrapErrorExpression(node);
  const root = rootIdentifier(expression) ?? "";

  if (/^(?:console|logger)$/iu.test(root) || root.endsWith("Logger")) {
    return false;
  }

  if (
    expression?.type === "NewExpression" &&
    looksLikeErrorIdentifier(rootIdentifier(expression.callee) ?? "")
  ) {
    return true;
  }

  if (looksLikeErrorIdentifier(rootIdentifier(expression) ?? "")) {
    return true;
  }

  let current = expression;

  while (current?.type === "MemberExpression") {
    if (/^(?:err|error)$/iu.test(memberName(current) ?? "")) {
      return true;
    }

    current = unwrapErrorExpression(current.object);
  }

  return false;
}

function wordingRead(node) {
  const expression = unwrapErrorExpression(node);

  if (expression?.type !== "MemberExpression") {
    return null;
  }

  const property = memberName(expression);

  if (INTRINSIC_ERROR_FIELDS.has(property)) {
    return property;
  }

  return WORDING_FIELDS.has(property) && isObviousErrorValue(expression.object) ? property : null;
}

function expectCallFromChain(node) {
  let current = unwrapErrorExpression(node);

  while (current?.type === "MemberExpression") {
    current = unwrapErrorExpression(current.object);
  }

  if (
    current?.type === "CallExpression" &&
    current.callee.type === "Identifier" &&
    current.callee.name === "expect"
  ) {
    return current;
  }

  return null;
}

function isStructuralExpected(node) {
  const expression = unwrapErrorExpression(node);

  if (
    (expression?.type === "Literal" && expression.value === null) ||
    (expression?.type === "Identifier" && expression.name === "undefined")
  ) {
    return true;
  }

  return (
    expression?.type === "CallExpression" &&
    rootIdentifier(expression.callee) === "expect" &&
    ["any", "anything"].includes(memberName(expression.callee))
  );
}

function isWordingLiteral(node) {
  const expression = unwrapErrorExpression(node);

  return (
    staticString(expression) !== null ||
    (expression?.type === "Literal" && expression.regex !== undefined)
  );
}

function objectWordingProperty(node) {
  const expression = unwrapErrorExpression(node);

  if (expression?.type !== "ObjectExpression") {
    return null;
  }

  for (const property of expression.properties) {
    if (property.type !== "Property" || !isWordingLiteral(property.value)) {
      continue;
    }

    let name = staticString(property.key);

    if (!property.computed) {
      name = property.key.name ?? name;
    }

    if (INTRINSIC_ERROR_FIELDS.has(name) || WORDING_FIELDS.has(name)) {
      return name;
    }
  }

  return null;
}

function report(context, node, property) {
  context.report({
    node,
    messageId: "assertStructure",
    data: { property },
  });
}

function checkNodeAssertion(context, node) {
  const method = memberName(node.callee);

  if (!WORDING_ASSERTION_METHODS.has(method) || node.arguments.length < ASSERTION_ARGUMENT_COUNT) {
    return;
  }

  const objectProperty = isObviousErrorValue(node.arguments[0])
    ? objectWordingProperty(node.arguments[1])
    : null;

  const property =
    objectProperty ?? (isWordingLiteral(node.arguments[1]) ? wordingRead(node.arguments[0]) : null);

  if (property) {
    report(context, node, property);
  }
}

export const noErrorMessageExpectations = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow wording assertions on syntactically obvious error values",
    },
    messages: {
      assertStructure:
        "Assert on the error tag, status, code, or structure—not its `.{{property}}` wording.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (rootIdentifier(node.callee) === "assert") {
          checkNodeAssertion(context, node);
          return;
        }

        const expectCall = expectCallFromChain(node.callee.object);

        if (expectCall === null) {
          return;
        }

        const matcher = memberName(node.callee);

        if (
          ALLOWED_STRUCTURAL_MATCHERS.has(matcher) ||
          expectCall.arguments[0]?.type === "UnaryExpression" ||
          node.arguments.some(isStructuralExpected)
        ) {
          return;
        }

        if (matcher === "toHaveProperty" && node.arguments.length >= ASSERTION_ARGUMENT_COUNT) {
          const property = staticString(node.arguments[0]);

          if (
            INTRINSIC_ERROR_FIELDS.has(property) ||
            (WORDING_FIELDS.has(property) && expectCall.arguments.some(isObviousErrorValue))
          ) {
            report(context, node, property);
          }

          return;
        }

        const objectProperty = expectCall.arguments.some(isObviousErrorValue)
          ? objectWordingProperty(node.arguments[0])
          : null;

        if (objectProperty) {
          report(context, node, objectProperty);
          return;
        }

        const property = wordingRead(expectCall.arguments[0]);

        if (
          property &&
          (node.arguments.some(isWordingLiteral) || WORDING_MATCHER_METHODS.has(matcher))
        ) {
          report(context, node, property);
        }
      },
    };
  },
};
