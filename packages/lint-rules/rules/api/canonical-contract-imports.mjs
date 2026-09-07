const CANONICAL_SUBPATHS = new Map([
  ["effect/Effect", "Effect"],
  ["effect/Redacted", "Redacted"],
  ["effect/Context", "Context"],
]);

const CONTRACT_IMPORTS = new Map([
  ["effect", new Set(["Effect", "Redacted", "Context"])],
  ["zod", new Set(["z"])],
  ["@hono/zod-openapi", new Set(["z", "createRoute"])],
]);

/** Preserves searchable import names used by schema and Effect lint visitors. */
export const canonicalContractImports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep canonical Effect and Zod import names so contract rules cannot be bypassed by aliases",
    },
    schema: [],
    messages: {
      zodVersion: "Use Zod v4; legacy Zod v3 contracts are prohibited.",
      canonicalName:
        "Import {{name}} by its canonical name so API and Effect rules can inspect its uses.",
    },
  },
  create(context) {
    function checkZodVersion(node) {
      const source = node.source?.value;

      if (source === "zod/v3" || source?.startsWith("zod/v3/")) {
        context.report({ node, messageId: "zodVersion" });
      }
    }

    return {
      ExportNamedDeclaration: checkZodVersion,
      ExportAllDeclaration: checkZodVersion,
      ImportExpression: checkZodVersion,
      ImportDeclaration(node) {
        checkZodVersion(node);

        if (node.importKind === "type") {
          return;
        }

        const canonicalSubpath = CANONICAL_SUBPATHS.get(node.source.value);

        if (canonicalSubpath !== undefined) {
          for (const specifier of node.specifiers) {
            if (specifier.importKind === "type") {
              continue;
            }

            if (
              specifier.type !== "ImportNamespaceSpecifier" ||
              specifier.local.name !== canonicalSubpath
            ) {
              context.report({
                node: specifier,
                messageId: "canonicalName",
                data: { name: canonicalSubpath },
              });
            }
          }

          return;
        }

        const source = node.source.value === "zod/v4" ? "zod" : node.source.value;
        const names = CONTRACT_IMPORTS.get(source);

        if (names === undefined) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.importKind === "type") {
            continue;
          }

          if (specifier.type === "ImportSpecifier") {
            const imported = specifier.imported.name ?? specifier.imported.value;

            if (names.has(imported) && specifier.local.name !== imported) {
              context.report({
                node: specifier,
                messageId: "canonicalName",
                data: { name: imported },
              });
            }
          } else if (source === "zod" && specifier.local.name !== "z") {
            context.report({ node: specifier, messageId: "canonicalName", data: { name: "z" } });
          } else if (source !== "zod") {
            context.report({
              node: specifier,
              messageId: "canonicalName",
              data: { name: [...names].join(", ") },
            });
          }
        }
      },
    };
  },
};
