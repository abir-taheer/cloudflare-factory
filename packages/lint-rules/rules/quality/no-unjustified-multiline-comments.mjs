// Memory feedback-justified-comments: comment blocks over 2 lines must earn
// their place — delete, shorten, or open with a `comment-necessary:` escape.

const ESCAPE_PATTERN = /^comment-necessary:\s*\S/u;

const DIRECTIVE_PATTERN =
  /^(?:eslint|eslint-disable|eslint-disable-next-line|eslint-disable-line|eslint-enable|prettier-ignore|@ts-|c8 |v8 |istanbul )/u;

const MAXIMUM_UNJUSTIFIED_LINES = 2;

function isDirectiveComment(comment) {
  return DIRECTIVE_PATTERN.test(comment.value.trim());
}

function isOwnLineComment(comment, sourceCode) {
  const lineText = sourceCode.lines[comment.loc.start.line - 1];
  const textBeforeComment = lineText.slice(0, comment.loc.start.column);
  return textBeforeComment.trim() === "";
}

function blockCommentContentLines(comment) {
  const lines = comment.value.split("\n").map((line) => line.replace(/^\s*\*?\s*/u, "").trim());
  return lines.filter((line) => line !== "" && line !== "/");
}

export const noUnjustifiedMultilineComments = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Comment blocks over 2 lines must be deleted, shortened, or opened with a `comment-necessary: <reason>` escape (memory feedback-justified-comments)",
    },
    schema: [],
    messages: {
      deleteShortenOrJustify:
        "This {{count}}-line comment has no escape. First decide whether it should exist at all: if it narrates what the code does, restates history, or hedges, delete it — do not compress it to {{maximum}} lines to slip under this rule. If it carries real information, cut it to {{maximum}} lines. Only if the full length is essential, open it with `comment-necessary: <why this comment must exist>` — a constraint, invariant, or external context the code cannot express.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function reportLineCommentGroup(group) {
      if (group.length <= MAXIMUM_UNJUSTIFIED_LINES) {
        return;
      }

      const openingText = group[0].value.trim();

      if (ESCAPE_PATTERN.test(openingText)) {
        return;
      }

      context.report({
        loc: {
          start: group[0].loc.start,
          end: group.at(-1).loc.end,
        },
        messageId: "deleteShortenOrJustify",
        data: {
          count: String(group.length),
          maximum: String(MAXIMUM_UNJUSTIFIED_LINES),
        },
      });
    }

    function checkBlockComment(comment) {
      const spannedLines = comment.loc.end.line - comment.loc.start.line + 1;

      if (spannedLines <= MAXIMUM_UNJUSTIFIED_LINES) {
        return;
      }

      const contentLines = blockCommentContentLines(comment);

      if (contentLines.length > 0 && ESCAPE_PATTERN.test(contentLines[0])) {
        return;
      }

      context.report({
        loc: comment.loc,
        messageId: "deleteShortenOrJustify",
        data: {
          count: String(spannedLines),
          maximum: String(MAXIMUM_UNJUSTIFIED_LINES),
        },
      });
    }

    return {
      Program() {
        let group = [];

        for (const comment of sourceCode.getAllComments()) {
          if (comment.type === "Block") {
            reportLineCommentGroup(group);
            group = [];

            if (isOwnLineComment(comment, sourceCode) && !isDirectiveComment(comment)) {
              checkBlockComment(comment);
            }

            continue;
          }

          if (!isOwnLineComment(comment, sourceCode) || isDirectiveComment(comment)) {
            reportLineCommentGroup(group);
            group = [];
            continue;
          }

          const previous = group.at(-1);

          const isAdjacent =
            previous !== undefined && comment.loc.start.line === previous.loc.end.line + 1;

          if (!isAdjacent) {
            reportLineCommentGroup(group);
            group = [];
          }

          group.push(comment);
        }

        reportLineCommentGroup(group);
      },
    };
  },
};
