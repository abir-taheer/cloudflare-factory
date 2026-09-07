/** Disallow explicit TypeScript assertions on changed lines. */

const ALLOWED_TYPES = new Set(["const", "unknown", "Promise<unknown>"]);

function normalizedTypeText(context, node) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  return sourceCode.getText(node).replaceAll(/\s+/gu, "");
}

export const noTypeCasts = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow explicit type assertions and non-null assertions on changed lines",
      category: "Type Safety",
      recommended: true,
    },
    messages: {
      noCast:
        "Type cast to `{{type}}` is not allowed. Restructure the code or use an explicit runtime type guard.",
      noNonNull: "Non-null assertions are not allowed. Prove or check the value before using it.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function checkAssertion(node) {
      const type = normalizedTypeText(context, node.typeAnnotation);

      if (ALLOWED_TYPES.has(type)) {
        return;
      }

      context.report({
        node: node.typeAnnotation,
        messageId: "noCast",
        data: { type },
      });
    }

    function checkDefiniteAssignment(node) {
      if (!node.definite) {
        return;
      }

      const typeAnnotation = node.typeAnnotation ?? node.id?.typeAnnotation;

      const tokenBeforeType = typeAnnotation ? sourceCode.getTokenBefore(typeAnnotation) : null;

      let definiteToken = tokenBeforeType;

      if (tokenBeforeType?.value !== "!") {
        definiteToken = sourceCode.getTokens(node).findLast((token) => token.value === "!");
      }

      context.report({
        node: definiteToken ?? node,
        messageId: "noNonNull",
      });
    }

    return {
      AccessorProperty: checkDefiniteAssignment,
      PropertyDefinition: checkDefiniteAssignment,
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
      TSNonNullExpression(node) {
        context.report({
          node: sourceCode.getLastToken(node) ?? node,
          messageId: "noNonNull",
        });
      },
      VariableDeclarator: checkDefiniteAssignment,
    };
  },
};
