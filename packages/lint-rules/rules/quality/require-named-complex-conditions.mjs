import { walkLintAst } from "../lint-ast-helpers.mjs";

const DEFERRED_FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

function hasChainedConditionCall(node) {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
    return false;
  }

  let receiver = node.callee.object;

  while (receiver) {
    if (receiver.type === "CallExpression" || receiver.type === "NewExpression") {
      return true;
    }

    if (receiver.type === "MemberExpression") {
      receiver = receiver.object;
    } else if (receiver.type === "ChainExpression") {
      receiver = receiver.expression;
    } else {
      return false;
    }
  }

  return false;
}

/** Names inline collection checks and chained calls before control-flow decisions. */
export const requireNamedComplexConditions = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Extract collection literals and call chains from conditions into named predicates",
    },
    schema: [],
    messages: {
      nameCondition:
        "Give this collection check or call-chain condition a descriptive boolean name before using it here. Preserve short-circuiting and loop reevaluation when restructuring.",
    },
  },
  create(context) {
    function checkCondition(node) {
      if (node.test === null) {
        return;
      }

      const complexExpressions = [];

      walkLintAst(node.test, (expression) => {
        if (DEFERRED_FUNCTION_TYPES.has(expression.type)) {
          return false;
        }

        if (
          expression.type === "ArrayExpression" ||
          expression.type === "ObjectExpression" ||
          hasChainedConditionCall(expression)
        ) {
          complexExpressions.push(expression);
          return false;
        }

        return true;
      });

      if (complexExpressions.length > 0) {
        context.report({ node: node.test, messageId: "nameCondition" });
      }
    }

    return {
      IfStatement: checkCondition,
      WhileStatement: checkCondition,
      DoWhileStatement: checkCondition,
      ForStatement: checkCondition,
      ConditionalExpression: checkCondition,
    };
  },
};
