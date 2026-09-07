// Shared Effect rules: "Effect.run* at boundaries only" — boundaries are
// exempted in .oxlintrc.json; reusable domain logic returns Effects.

import { isEffectApiMember } from "../lint-ast-helpers.mjs";

const RUN_METHODS = new Set([
  "runSync",
  "runSyncWith",
  "runSyncExitWith",
  "runPromiseWith",
  "runPromiseExitWith",
  "runForkWith",
  "runCallbackWith",
  "runSyncExit",
  "runPromise",
  "runPromiseExit",
  "runFork",
  "runCallback",
]);

/** Enforces no effect run through ESLint-compatible AST visitors. */
export const noEffectRun = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow Effect.run* outside application boundaries; return the Effect and let the boundary execute it",
    },
    schema: [],
    messages: {
      boundaryOnly:
        "Effect.{{method}} must only run at application boundaries (entrypoints, middleware, tests). Return the Effect and let the caller execute it.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isEffectApiMember(node, RUN_METHODS)) {
          return;
        }

        context.report({
          node,
          messageId: "boundaryOnly",
          data: { method: node.property.name },
        });
      },
    };
  },
};
