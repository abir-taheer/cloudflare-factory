const ROUTE_ARGUMENT_COUNT = 2;

const HTTP_ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all",
  "on",
]);

function resolveRoutePath(node, context, visited = new Set()) {
  if (node?.type !== "Identifier" || visited.has(node.name)) {
    return node;
  }

  visited.add(node.name);

  let scope = context.sourceCode.getScope(node);

  while (scope !== null) {
    const variable = scope.variables.find((entry) => entry.name === node.name);

    if (variable !== undefined) {
      const declaration = variable.defs.find((definition) => definition.type === "Variable");
      return resolveRoutePath(declaration?.node.init, context, visited);
    }

    scope = scope.upper;
  }

  return node;
}

/** Keeps API route registration on OpenAPI's schema-inferred handler boundary. */
export const noUntypedApiRoutes = {
  meta: {
    type: "problem",
    docs: { description: "Require API route modules to register schema-typed OpenAPI routes" },
    schema: [],
    messages: {
      useOpenApi:
        "Register API routes with .openapi(namedRoute, handler) so request and response types come from named Zod schemas.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        if (callee.type !== "MemberExpression" || node.arguments.length < ROUTE_ARGUMENT_COUNT) {
          return;
        }

        const method = callee.computed ? callee.property.value : callee.property.name;

        if (!HTTP_ROUTE_METHODS.has(method)) {
          return;
        }

        const pathArgument = resolveRoutePath(
          method === "on" ? node.arguments[1] : node.arguments[0],
          context,
        );

        // Context/header/store accessors share get(); only path registrations are routes.
        if (pathArgument?.type !== "Literal" || typeof pathArgument.value !== "string") {
          return;
        }

        if (!pathArgument.value.startsWith("/") && pathArgument.value !== "*") {
          return;
        }

        context.report({ node, messageId: "useOpenApi" });
      },
    };
  },
};
