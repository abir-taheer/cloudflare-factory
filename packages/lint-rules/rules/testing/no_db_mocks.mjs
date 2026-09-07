import {
  findDatabaseMockBinding,
  getDatabaseMockRoot,
  getDatabaseMockSource,
  isDatabaseMockModule,
  isDatabaseMockTarget,
} from "./database_mock_provenance.mjs";

const MODULE_MOCK_METHODS = new Set(["doMock", "mock", "unstable_mockModule", "module"]);

const PROPERTY_MOCK_METHODS = new Set([
  "method",
  "mockObject",
  "replace",
  "replaceGetter",
  "replaceSetter",
  "spyOn",
  "stub",
]);

function isDatabaseMockApi(node, context) {
  const root = getDatabaseMockRoot(node);

  if (root === null) {
    return false;
  }

  const binding = findDatabaseMockBinding(root.name, root, context);

  if (binding === undefined) {
    return root.name === "vi" || root.name === "jest";
  }

  return binding.defs.some((definition) => {
    if (definition.type !== "ImportBinding") {
      return false;
    }

    const source = definition.parent.source.value;

    return (
      ["vitest", "@jest/globals"].includes(source) ||
      (source === "node:test" && definition.node.imported?.name === "mock")
    );
  });
}

/** Rejects direct database mocking using real import provenance, including pg/Drizzle instances. */
export const noDbMocks = {
  meta: {
    type: "problem",
    docs: { description: "Reject database mocks; test real persisted/query outcomes" },
    schema: [],
    messages: {
      moduleMock:
        "Do not mock database module {{source}}. Use the test database and assert persisted/query results.",
      propertyMock:
        "Do not mock or spy on database bindings. Use the test database and assert persisted/query results.",
      assignmentMock:
        "Do not replace database bindings. Use the test database and assert persisted/query results.",
    },
  },
  create(context) {
    if (
      !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:spec|test)(?:\.(?:e2e|self-hosted))?\.[cm]?[jt]sx?$/iu.test(
        context.filename,
      )
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;

        if (callee.type !== "MemberExpression" || !isDatabaseMockApi(callee.object, context)) {
          return;
        }

        const method = callee.computed
          ? getDatabaseMockSource(callee.property)
          : callee.property.name;

        if (MODULE_MOCK_METHODS.has(method)) {
          const source = getDatabaseMockSource(node.arguments[0]);

          if (source !== null && isDatabaseMockModule(source)) {
            context.report({ node, messageId: "moduleMock", data: { source } });
          }
        } else if (
          PROPERTY_MOCK_METHODS.has(method) &&
          isDatabaseMockTarget(node.arguments[0], context)
        ) {
          context.report({ node, messageId: "propertyMock" });
        }
      },
      AssignmentExpression(node) {
        if (isDatabaseMockTarget(node.left, context)) {
          context.report({ node, messageId: "assignmentMock" });
        }
      },
    };
  },
};
