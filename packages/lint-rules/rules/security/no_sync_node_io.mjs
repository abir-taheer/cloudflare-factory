const NODE_IO_MODULES = new Set(["fs", "child_process", "crypto", "dns", "zlib"]);

function findNodeIoImport(identifier, node, context) {
  let scope = context.sourceCode.getScope(node);

  while (scope !== null) {
    const binding = scope.variables.find((variable) => variable.name === identifier);

    if (binding !== undefined) {
      return binding.defs.find((definition) => {
        if (definition.type !== "ImportBinding") {
          return false;
        }

        const source = definition.parent.source.value.replace(/^node:/u, "");
        return NODE_IO_MODULES.has(source);
      });
    }

    scope = scope.upper;
  }
}

/** Rejects synchronous Node I/O without confusing pure Effect or Schema evaluation with I/O. */
export const noSyncNodeIo = {
  meta: {
    type: "problem",
    docs: { description: "Reject synchronous operations imported from Node I/O modules" },
    schema: [],
    messages: { useAsyncIo: "Use an asynchronous Node I/O API at runtime instead of {{method}}." },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        const root = callee.type === "MemberExpression" ? callee.object : callee;

        if (root.type !== "Identifier") {
          return;
        }

        const definition = findNodeIoImport(root.name, node, context);

        if (definition === undefined) {
          return;
        }

        let method = definition.node.imported?.name;

        if (callee.type === "MemberExpression") {
          method = callee.computed ? callee.property.value : callee.property.name;
        }

        if (typeof method === "string" && method.endsWith("Sync")) {
          context.report({ node, messageId: "useAsyncIo", data: { method } });
        }
      },
    };
  },
};
