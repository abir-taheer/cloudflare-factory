import {
  getPromiseMethodName,
  hasAwaitedPromiseAncestor,
  isImportedEffectCall,
} from "./promise_effect_helpers.mjs";

const PROMISE_CHAIN_METHODS = new Set(["then", "catch", "finally"]);

/** Preserves Promise chain style enforcement without treating Effect.catch as a Promise. */
export const preferAwaitToThen = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer await for Promise chains while permitting imported Effect combinators",
    },
    schema: [
      { type: "object", properties: { strict: { type: "boolean" } }, additionalProperties: false },
    ],
    messages: {
      preferAwait:
        "Use await for Promise chains; Effect combinators remain in the Effect error channel.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!PROMISE_CHAIN_METHODS.has(getPromiseMethodName(node.callee))) {
          return;
        }

        if (isImportedEffectCall(node, context) || node.parent.type === "ReturnStatement") {
          return;
        }

        if (context.options[0]?.strict !== true && hasAwaitedPromiseAncestor(node)) {
          return;
        }

        context.report({ node, messageId: "preferAwait" });
      },
    };
  },
};
