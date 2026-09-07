// no-inline-object-types: no inline object type literals in annotations;
// name the type or derive it (Pick, z.infer). Named aliases and Data.TaggedError are fine.

/** Enforces no inline object types through ESLint-compatible AST visitors. */
export const noInlineObjectTypes = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow inline object type literals in parameter, return, and variable annotations; name the type instead",
    },
    schema: [],
    messages: {
      nameTheType:
        "Name this object type (type alias, interface, Pick, or infer from the schema) instead of writing it inline in an annotation.",
    },
  },
  create(context) {
    return {
      TSTypeLiteral(node) {
        let sawTypeAnnotation = false;
        let ancestor = node.parent;

        while (ancestor) {
          if (
            ancestor.type === "TSTypeAliasDeclaration" ||
            ancestor.type === "TSInterfaceDeclaration" ||
            ancestor.type === "TSTypeLiteral"
          ) {
            return;
          }

          if (ancestor.type === "TSTypeAnnotation") {
            sawTypeAnnotation = true;
          }

          ancestor = ancestor.parent;
        }

        if (sawTypeAnnotation) {
          context.report({ node, messageId: "nameTheType" });
        }
      },
    };
  },
};
