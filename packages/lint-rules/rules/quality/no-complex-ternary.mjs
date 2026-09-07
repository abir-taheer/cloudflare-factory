/** Flag ternary expressions whose branches are too complex to read inline. */

const MAX_ARGS = 2;
const MAX_LINES = 3;

function isSimpleArg(node) {
  if (!node) {
    return true;
  }

  switch (node.type) {
    case "Identifier":
    case "Literal": {
      return true;
    }
    case "MemberExpression": {
      return true;
    }
    case "UnaryExpression": {
      return isSimpleArg(node.argument);
    }
    case "TemplateLiteral": {
      return node.expressions.length === 0;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression": {
      return isSimpleArg(node.expression);
    }
    default: {
      return false;
    }
  }
}

function isSimpleCall(node) {
  if (node?.type !== "CallExpression") {
    return false;
  }

  return node.arguments.length <= MAX_ARGS && node.arguments.every(isSimpleArg);
}

function isTrivialBranch(node) {
  if (!node) {
    return true;
  }

  switch (node.type) {
    case "Identifier":
    case "Literal": {
      return true;
    }
    case "MemberExpression": {
      return true;
    }
    case "UnaryExpression": {
      return isTrivialBranch(node.argument);
    }
    case "TemplateLiteral": {
      return node.expressions.length === 0;
    }
    case "ArrayExpression": {
      return node.elements.length === 0;
    }
    case "ObjectExpression": {
      return node.properties.length === 0;
    }
    case "CallExpression": {
      return isSimpleCall(node);
    }
    case "AwaitExpression": {
      return node.argument && (isSimpleCall(node.argument) || isTrivialBranch(node.argument));
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression": {
      return isTrivialBranch(node.expression);
    }
    default: {
      return false;
    }
  }
}

export const noComplexTernary = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow complex expressions inside ternary branches",
      category: "Readability",
      recommended: true,
    },
    messages: {
      noComplexTernary:
        "Ternary branches must be trivial. Extract the complex expression to a named const, or use if/else.",
      tooManyLines: "Ternary spans too many lines. Use if/else instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (node.parent?.type === "SpreadElement") {
          return;
        }

        if (node.loc && node.loc.end.line - node.loc.start.line + 1 > MAX_LINES) {
          context.report({
            node,
            messageId: "tooManyLines",
          });

          return;
        }

        if (!isTrivialBranch(node.consequent) || !isTrivialBranch(node.alternate)) {
          context.report({
            node,
            messageId: "noComplexTernary",
          });
        }
      },
    };
  },
};
