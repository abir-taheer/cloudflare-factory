// Shared Effect rules: use Effect logging; when the level varies, emit a
// single Effect.logWithLevel — never conditionally construct logError/logWarning.

import { isEffectApiMember } from "../lint_ast_helpers.mjs";

const LEVELED_LOG_METHODS = new Set([
  "log",
  "logTrace",
  "logDebug",
  "logInfo",
  "logWarning",
  "logError",
  "logFatal",
]);

function containsEffectLogCall(node) {
  let current = node;

  while (current) {
    if (current.type === "CallExpression") {
      if (isEffectApiMember(current.callee, LEVELED_LOG_METHODS)) {
        return true;
      }

      if (current.callee.type === "MemberExpression") {
        current = current.callee.object;
        continue;
      }

      current = current.callee;
      continue;
    }

    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }

    return false;
  }

  return false;
}

function isLogBranch(node) {
  return isEffectApiMember(node, LEVELED_LOG_METHODS) || containsEffectLogCall(node);
}

/** Enforces no conditional log level through ESLint-compatible AST visitors. */
export const noConditionalLogLevel = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow selecting between Effect.log* calls conditionally; pick a LogLevel value and call Effect.logWithLevel once",
    },
    schema: [],
    messages: {
      useLogWithLevel:
        "Do not conditionally construct Effect.log* descriptions. Choose a LogLevel value (level-as-data) and emit one Effect.logWithLevel(level, ...) call.",
    },
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (isLogBranch(node.consequent) && isLogBranch(node.alternate)) {
          context.report({ node, messageId: "useLogWithLevel" });
        }
      },
    };
  },
};
