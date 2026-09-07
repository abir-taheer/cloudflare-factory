const ASSERTION_ARGUMENT_COUNT = 2;

// Memory feedback-structural-asserts: two or more consecutive per-property
// equality asserts on one object become one assert.partialDeepStrictEqual.

const EQUALITY_METHODS = new Set(["equal", "strictEqual", "deepEqual", "deepStrictEqual"]);

// Collection-shape asserts read better as explicit length/size checks and do
// not translate cleanly into a partial structural match.
const COLLECTION_SHAPE_PROPERTIES = new Set(["length", "size"]);

const MINIMUM_RUN_PROPERTIES = 2;

function propertyAssertTarget(statement) {
  if (statement.type !== "ExpressionStatement") {
    return null;
  }

  const call = statement.expression;

  if (call.type !== "CallExpression" || call.arguments.length < ASSERTION_ARGUMENT_COUNT) {
    return null;
  }

  const callee = call.callee;

  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "assert" ||
    callee.property.type !== "Identifier" ||
    !EQUALITY_METHODS.has(callee.property.name)
  ) {
    return null;
  }

  const actual = call.arguments[0];

  if (actual.type !== "MemberExpression") {
    return null;
  }

  // Absence checks cannot become a partial match: partialDeepStrictEqual
  // requires an expected key to exist even when its value is undefined.
  const expected = call.arguments[1];

  if (expected.type === "Identifier" && expected.name === "undefined") {
    return null;
  }

  let propertyName = null;

  if (!actual.computed && actual.property.type === "Identifier") {
    propertyName = actual.property.name;
  }

  if (actual.computed && actual.property.type === "Literal") {
    propertyName = String(actual.property.value);
  }

  if (propertyName === null || COLLECTION_SHAPE_PROPERTIES.has(propertyName)) {
    return null;
  }

  return { call, object: actual.object, propertyName };
}

export const preferPartialDeepStrictEqual = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Collapse runs of per-property assert.equal calls on one object into a single assert.partialDeepStrictEqual (memory feedback-structural-asserts)",
    },
    schema: [],
    messages: {
      useStructuralMatch:
        "These {{count}} consecutive asserts each check one property of `{{object}}`. State the expected shape once: assert.partialDeepStrictEqual({{object}}, { ... }).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function reportRun(run) {
      const distinctProperties = new Set(run.map((target) => target.propertyName));

      if (distinctProperties.size < MINIMUM_RUN_PROPERTIES) {
        return;
      }

      context.report({
        node: run[0].call,
        messageId: "useStructuralMatch",
        data: {
          count: String(run.length),
          object: sourceCode.getText(run[0].object),
        },
      });
    }

    function checkStatementList(statements) {
      let run = [];
      let runObjectText = null;

      for (const statement of statements) {
        const target = propertyAssertTarget(statement);
        const objectText = target === null ? null : sourceCode.getText(target.object);

        if (objectText !== null && objectText === runObjectText) {
          run.push(target);
          continue;
        }

        reportRun(run);

        if (target === null) {
          run = [];
          runObjectText = null;
        } else {
          run = [target];
          runObjectText = objectText;
        }
      }

      reportRun(run);
    }

    return {
      Program(node) {
        checkStatementList(node.body);
      },
      BlockStatement(node) {
        checkStatementList(node.body);
      },
    };
  },
};
