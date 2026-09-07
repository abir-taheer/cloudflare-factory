import {
  getPromiseMethodName,
  hasAwaitedPromiseAncestor,
  isImportedEffectCall,
} from "./promise_effect_helpers.mjs";
import { isPromisifyCallback } from "./promisify_callback_boundary.mjs";

const COLLECTION_CALLBACK_ARGUMENT_COUNT = 2;

const ARRAY_CALLBACK_METHODS = new Set(["map", "every", "forEach", "some", "find", "filter"]);
const CALLBACK_NAMES = new Set(["cb", "callback"]);
const ERROR_PARAMETER_NAMES = new Set(["err", "error"]);
const EVENT_CALLBACK_METHODS = new Set(["on", "once", "addEventListener", "removeEventListener"]);

function isCollectionCallback(node, method) {
  const isLodash =
    node.callee.type === "MemberExpression" &&
    ["_", "lodash", "underscore"].includes(node.callee.object.name);

  return (
    (ARRAY_CALLBACK_METHODS.has(method) &&
      (node.arguments.length === 1 ||
        (node.arguments.length === COLLECTION_CALLBACK_ARGUMENT_COUNT && isLodash))) ||
    (ARRAY_CALLBACK_METHODS.has(node.callee.name) &&
      node.arguments.length === COLLECTION_CALLBACK_ARGUMENT_COUNT)
  );
}

/** Rejects Node callback conventions while retaining Effect and event/collection callbacks. */
export const preferAwaitToCallbacks = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer await over Node callback patterns without flagging typed Effect error callbacks",
    },
    schema: [],
    messages: { preferAwait: "Use a Promise adapter and await instead of a Node-style callback." },
  },
  create(context) {
    function checkCallbackParameter(node) {
      if (isPromisifyCallback(node, context)) {
        return;
      }

      const parameter = node.params.at(-1);

      if (parameter?.type === "Identifier" && CALLBACK_NAMES.has(parameter.name)) {
        context.report({ node: parameter, messageId: "preferAwait" });
      }
    }

    return {
      FunctionDeclaration: checkCallbackParameter,
      FunctionExpression: checkCallbackParameter,
      ArrowFunctionExpression: checkCallbackParameter,
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CALLBACK_NAMES.has(node.callee.name)) {
          context.report({ node, messageId: "preferAwait" });
          return;
        }

        if (isImportedEffectCall(node, context) || hasAwaitedPromiseAncestor(node)) {
          return;
        }

        const method = getPromiseMethodName(node.callee);

        if (EVENT_CALLBACK_METHODS.has(method) || isCollectionCallback(node, method)) {
          return;
        }

        const callback = node.arguments.at(-1);

        if (
          callback?.type !== "ArrowFunctionExpression" &&
          callback?.type !== "FunctionExpression"
        ) {
          return;
        }

        const parameter = callback.params[0];

        if (parameter?.type === "Identifier" && ERROR_PARAMETER_NAMES.has(parameter.name)) {
          context.report({ node: callback, messageId: "preferAwait" });
        }
      },
    };
  },
};
