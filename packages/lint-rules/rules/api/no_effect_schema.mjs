const EFFECT_NAMESPACE_NAMES = new Set(["Effect", "effect"]);

function isEffectSchemaModule(source) {
  return typeof source === "string" && /^effect\/[Ss]chema/u.test(source);
}

/** Requires Zod contracts instead of Effect Schema, including dynamic and re-export paths. */
export const noEffectSchema = {
  meta: {
    type: "problem",
    docs: { description: "Use pinned Zod v4 for all schema validation" },
    schema: [],
    messages: {
      useZod: "Effect Schema is prohibited. Define and validate this contract with Zod v4.",
    },
  },
  create(context) {
    function checkSchemaSource(node) {
      const source = node.source?.value;

      if (isEffectSchemaModule(source)) {
        context.report({ node, messageId: "useZod" });
        return;
      }

      if (source === "effect") {
        for (const specifier of node.specifiers ?? []) {
          const imported = specifier.imported?.name ?? specifier.local?.name;

          if (imported === "Schema") {
            context.report({ node: specifier, messageId: "useZod" });
          }
        }
      }
    }

    return {
      ImportDeclaration: checkSchemaSource,
      ExportNamedDeclaration: checkSchemaSource,
      ExportAllDeclaration: checkSchemaSource,
      ImportExpression(node) {
        if (isEffectSchemaModule(node.source.value)) {
          context.report({ node, messageId: "useZod" });
        }
      },
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;

        if (
          name === "Schema" &&
          node.object.type === "Identifier" &&
          EFFECT_NAMESPACE_NAMES.has(node.object.name)
        ) {
          context.report({ node, messageId: "useZod" });
        }
      },
    };
  },
};
