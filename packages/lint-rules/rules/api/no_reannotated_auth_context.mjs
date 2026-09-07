// AGENTS.md Observability: runRouteEffect annotates caller identity on every
// request log; routes and services annotate only operation-specific context.

const RESERVED_ANNOTATION_KEYS = new Set([
  "auth.subject",
  "auth.token_id",
  "auth.toolkit_scope",
  "http.request_id",
  "auth.user_id",
  "auth.organization_id",
]);

export const noReannotatedAuthContext = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow re-annotating caller identity keys owned by runRouteEffect (auth.subject, auth.token_id, auth.toolkit_scope, http.request_id) (AGENTS.md Observability)",
    },
    schema: [],
    messages: {
      reservedKey:
        '"{{key}}" is annotated for every request log by runRouteEffect (src/lib/hono.ts). Annotate only operation-specific context here.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        const isAnnotateLogs =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Effect" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "annotateLogs";

        if (!isAnnotateLogs || node.arguments.length === 0) {
          return;
        }

        const firstArgument = node.arguments[0];

        if (
          firstArgument.type === "Literal" &&
          typeof firstArgument.value === "string" &&
          RESERVED_ANNOTATION_KEYS.has(firstArgument.value)
        ) {
          context.report({
            node: firstArgument,
            messageId: "reservedKey",
            data: { key: firstArgument.value },
          });

          return;
        }

        if (firstArgument.type !== "ObjectExpression") {
          return;
        }

        for (const property of firstArgument.properties) {
          if (property.type !== "Property") {
            continue;
          }

          if (
            property.key.type === "Literal" &&
            typeof property.key.value === "string" &&
            RESERVED_ANNOTATION_KEYS.has(property.key.value)
          ) {
            context.report({
              node: property.key,
              messageId: "reservedKey",
              data: { key: property.key.value },
            });
          }
        }
      },
    };
  },
};
