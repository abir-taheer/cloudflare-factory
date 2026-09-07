// Adapted from Keyring. A defect handler that ignores its cause leaves the
// failure undescribed, so production defects become difficult to attribute.

import { isEffectApiMember } from "../lint-ast-helpers.mjs";

// tapCause is intentionally excluded: cleanup may legitimately react to
// any failure without inspecting the cause.
const CAUSE_CALLBACK_METHODS = new Set(["tapDefect", "catchCause", "onError"]);
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

function causeCallback(node) {
  const [first, second] = node.arguments;

  if (first !== undefined && FUNCTION_TYPES.has(first.type)) {
    return first;
  }

  if (second !== undefined && FUNCTION_TYPES.has(second.type)) {
    return second;
  }
}

function isCauseParameterUnused(context, callback, causeParameter) {
  if (causeParameter.type !== "Identifier") {
    return false;
  }

  const declaredVariables = context.sourceCode.getDeclaredVariables(callback);
  const causeVariable = declaredVariables.find((variable) => variable.name === causeParameter.name);
  return causeVariable !== undefined && causeVariable.references.length === 0;
}

/** Enforces no ignored cause callback through ESLint-compatible AST visitors. */
export const noIgnoredCauseCallback = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require Effect defect/cause callbacks to retain the underlying failure in diagnostics",
    },
    schema: [],
    messages: {
      acceptCause:
        "This callback drops the cause. Accept it as a parameter and pass it to the diagnostic or log.",
      useCause:
        "The cause parameter is unused. Pass it to the diagnostic or log so the failure remains attributable.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectApiMember(node.callee, CAUSE_CALLBACK_METHODS)) {
          return;
        }

        const callback = causeCallback(node);

        if (callback === undefined) {
          return;
        }

        if (callback.params.length === 0) {
          context.report({ node: callback, messageId: "acceptCause" });
          return;
        }

        if (isCauseParameterUnused(context, callback, callback.params[0])) {
          context.report({ node: callback.params[0], messageId: "useCause" });
        }
      },
    };
  },
};
