/** Disallow anonymous object types in annotations on changed lines. */

const INLINE_TYPE_CONTEXTS = new Set([
  "TSSatisfiesExpression",
  "TSTypeAnnotation",
  "TSTypeParameter",
  "TSTypeParameterInstantiation",
]);

const SIGNATURE_CONTEXTS = new Set([
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSFunctionType",
  "TSMethodSignature",
]);

function isDeclarationGenericClause(node, declaration) {
  let branch = node;

  while (branch.parent && branch.parent !== declaration) {
    branch = branch.parent;
  }

  return (
    branch.parent === declaration &&
    (branch === declaration.typeParameters || declaration.extends?.includes(branch))
  );
}

export const noInlineGenericObjectTypes = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require named or derived types instead of inline object type annotations",
      category: "Maintainability",
      recommended: true,
    },
    messages: {
      nameTheType: "Name this object type with a type alias, interface, Pick, or schema inference.",
    },
    schema: [],
  },
  create(context) {
    function checkObjectType(node) {
      let sawInlineTypeContext = false;
      let sawSignatureContext = false;
      let ancestor = node.parent;

      while (ancestor) {
        if (ancestor.type === "TSTypeLiteral" && !sawSignatureContext) {
          return;
        }

        if (
          ancestor.type === "TSTypeAliasDeclaration" ||
          ancestor.type === "TSInterfaceDeclaration"
        ) {
          if (!sawSignatureContext && !isDeclarationGenericClause(node, ancestor)) {
            return;
          }

          break;
        }

        if (INLINE_TYPE_CONTEXTS.has(ancestor.type)) {
          sawInlineTypeContext = true;
        }

        if (SIGNATURE_CONTEXTS.has(ancestor.type)) {
          sawSignatureContext = true;
        }

        ancestor = ancestor.parent;
      }

      if (sawInlineTypeContext) {
        context.report({ node, messageId: "nameTheType" });
      }
    }

    return {
      TSMappedType: checkObjectType,
      TSTypeLiteral: checkObjectType,
    };
  },
};
