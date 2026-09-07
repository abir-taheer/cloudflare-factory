// Adapted from Keyring: each OpenAPI route definition should have one primary
// reason to change and live in a file named for that operation.

/** Enforces one create route per file through ESLint-compatible AST visitors. */
export const oneCreateRoutePerFile = {
  meta: {
    type: "suggestion",
    docs: { description: "Allow at most one createRoute definition per file" },
    schema: [],
    messages: {
      oneRoutePerFile:
        "Only one createRoute definition is allowed per file. Move this route into its own resource operation module.",
    },
  },
  create(context) {
    let createRouteCount = 0;

    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "createRoute") {
          return;
        }

        createRouteCount += 1;

        if (createRouteCount > 1) {
          context.report({ node, messageId: "oneRoutePerFile" });
        }
      },
    };
  },
};
