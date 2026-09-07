// AGENTS.md Readability: blank lines between statement types create visual
// structure; one declaration-use pair may stay tight, control flow never may.

const DECLARATION_USE_PAIR_LENGTH = 2;

const STATEMENT_TYPE_GROUPS = {
  declarations: [
    "VariableDeclaration",
    "FunctionDeclaration",
    "ClassDeclaration",
    "TSInterfaceDeclaration",
    "TSTypeAliasDeclaration",
    "TSEnumDeclaration",
    "TSModuleDeclaration",
    "TSDeclareFunction",
  ],
  imports: ["ImportDeclaration", "TSImportEqualsDeclaration"],
  control: [
    "IfStatement",
    "SwitchStatement",
    "ForStatement",
    "ForOfStatement",
    "ForInStatement",
    "WhileStatement",
    "DoWhileStatement",
    "TryStatement",
  ],
  blocks: ["BlockStatement"],
};

const VISITED_NODE_TYPES = [
  ...STATEMENT_TYPE_GROUPS.declarations,
  ...STATEMENT_TYPE_GROUPS.imports,
  ...STATEMENT_TYPE_GROUPS.control,
  ...STATEMENT_TYPE_GROUPS.blocks,
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "ExpressionStatement",
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
  "LabeledStatement",
  "EmptyStatement",
  "DebuggerStatement",
];

// `export const x` wraps the real declaration in ExportNamedDeclaration;
// classify by the inner declaration so exports group with their own kind.
function unwrapExportDeclaration(node) {
  if (
    (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") &&
    node.declaration !== null &&
    node.declaration !== undefined
  ) {
    return node.declaration;
  }

  return node;
}

function getStatementTypeGroup(node) {
  const unwrapped = unwrapExportDeclaration(node);

  for (const [groupName, types] of Object.entries(STATEMENT_TYPE_GROUPS)) {
    if (types.includes(unwrapped.type)) {
      return groupName;
    }
  }

  return "other";
}

function hasBlankLineBetween(sourceCode, previousStatement, nextStatement) {
  const previousEndLine = previousStatement.loc.end.line;
  const nextStartLine = nextStatement.loc.start.line;
  // Lines strictly between the two statements (0-based index is line - 1).
  const linesBetween = sourceCode.lines.slice(previousEndLine, nextStartLine - 1);
  // Comment-only lines must not count as separation; only truly empty lines do.
  return linesBetween.some((line) => line.trim() === "");
}

export const requireBlankLinesBetweenStatementTypes = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: {
      description:
        "Require blank lines between different statement types to create visual structure and reduce cognitive load",
    },
    schema: [],
    messages: {
      missingBlankLine:
        "Add a blank line between this {{previousType}} and {{nextType}} statement type",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function getSiblingStatements(node) {
      const parent = node.parent;

      if (!parent) {
        return null;
      }

      // Case bodies live on SwitchCase.consequent rather than a body array.
      if (parent.type === "SwitchCase") {
        return parent.consequent;
      }

      if (parent.type === "Program" || parent.type === "BlockStatement") {
        return parent.body;
      }

      return null;
    }

    function checkStatement(node) {
      const statements = getSiblingStatements(node);

      if (statements === null) {
        return;
      }

      const currentIndex = statements.indexOf(node);

      if (currentIndex === -1 || currentIndex === statements.length - 1) {
        return;
      }

      const nextStatement = statements[currentIndex + 1];
      const previousType = getStatementTypeGroup(node);
      const nextType = getStatementTypeGroup(nextStatement);

      const hasMultilineStatement =
        node.loc.start.line !== node.loc.end.line ||
        nextStatement.loc.start.line !== nextStatement.loc.end.line;

      if (previousType === nextType && (!hasMultilineStatement || previousType === "imports")) {
        return;
      }

      if (hasBlankLineBetween(sourceCode, node, nextStatement)) {
        return;
      }

      if (!hasMultilineStatement && previousType === "declarations" && nextType === "other") {
        // A declaration-use pair of exactly two may stay tight; a second
        // packed plain statement re-requires the blank line after the declaration.
        const statementAfterPair = statements[currentIndex + DECLARATION_USE_PAIR_LENGTH];

        const pairEndsThePack =
          statementAfterPair === undefined ||
          getStatementTypeGroup(statementAfterPair) !== "other" ||
          hasBlankLineBetween(sourceCode, nextStatement, statementAfterPair);

        if (pairEndsThePack) {
          return;
        }
      }

      // Statements sharing a line cannot be separated by a whitespace-only
      // fix; splitting them needs manual restructuring, so report only.
      const shareOneLine = node.loc.end.line === nextStatement.loc.start.line;

      // Insert at the start of the line after the previous statement so a
      // trailing comment on that line stays attached to its statement.
      const insertBlankLineAfterPrevious = (fixer) => {
        const insertIndex = sourceCode.getIndexFromLoc({
          line: node.loc.end.line + 1,
          column: 0,
        });

        return fixer.insertTextBeforeRange([insertIndex, insertIndex], "\n");
      };

      context.report({
        node: nextStatement,
        messageId: "missingBlankLine",
        data: {
          previousType,
          nextType,
        },
        fix: shareOneLine ? null : insertBlankLineAfterPrevious,
      });
    }

    const visitors = {};

    for (const nodeType of VISITED_NODE_TYPES) {
      visitors[nodeType] = checkStatement;
    }

    return visitors;
  },
};
