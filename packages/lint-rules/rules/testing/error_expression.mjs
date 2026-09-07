const ERROR_EXPRESSION_WRAPPERS = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** Removes transparent syntax wrappers when inspecting error assertions. */
export function unwrapErrorExpression(node) {
  let expression = node;

  while (ERROR_EXPRESSION_WRAPPERS.has(expression?.type)) {
    expression = expression.expression;
  }

  return expression;
}
