import { getFluentCallRoot, isZodRootedCall } from "../lint-ast-helpers.mjs";

function collectDerivedSchemas(schemas, candidates) {
  let previousSize = -1;

  while (previousSize !== schemas.size) {
    previousSize = schemas.size;

    for (const [name, expression] of candidates) {
      const root = getFluentCallRoot(expression);

      if (root?.type === "Identifier" && schemas.has(root.name)) {
        schemas.add(name);
      }
    }
  }
}

/** Keeps paired Zod data contracts derived while allowing service interfaces. */
export const requireSchemaDerivedContracts = {
  meta: {
    type: "problem",
    docs: { description: "Derive paired data contracts from their named Zod schema" },
    schema: [],
    messages: {
      deriveContract: "Derive {{name}} from {{name}}Schema using z.infer, z.input, or z.output.",
    },
  },
  create(context) {
    const schemas = new Set();
    const candidates = new Map();
    const contracts = [];

    return {
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.id.name.endsWith("Schema") &&
          node.init !== null
        ) {
          candidates.set(node.id.name, node.init);

          if (isZodRootedCall(node.init)) {
            schemas.add(node.id.name);
          }
        }
      },
      TSInterfaceDeclaration(node) {
        const hasBehavior = node.body.body.some(
          (member) =>
            member.type === "TSMethodSignature" ||
            member.type === "TSCallSignatureDeclaration" ||
            member.typeAnnotation?.typeAnnotation.type === "TSFunctionType",
        );

        if (!hasBehavior && node.extends.length === 0) {
          contracts.push(node);
        }
      },
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type === "TSTypeLiteral") {
          contracts.push(node);
        }
      },
      "Program:exit"() {
        collectDerivedSchemas(schemas, candidates);

        for (const node of contracts) {
          if (schemas.has(`${node.id.name}Schema`)) {
            context.report({ node, messageId: "deriveContract", data: { name: node.id.name } });
          }
        }
      },
    };
  },
};
