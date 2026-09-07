// Shared Effect rules: never log secrets — a syntactic tripwire for
// Redacted.value(...) and secret-named identifiers in log arguments.

import { isEffectApiMember, walkLintAst } from "../lint-ast-helpers.mjs";

const LOGGING_METHODS = new Set([
  "log",
  "logTrace",
  "logDebug",
  "logInfo",
  "logWarning",
  "logError",
  "logFatal",
  "logWithLevel",
  "annotateLogs",
  "annotateSpans",
  "annotateCurrentSpan",
  "withSpan",
]);

const DEFAULT_DENY_PATTERN =
  "plaintext|decrypted|secretaccesskey|sessiontoken|privatekey|keymaterial|password|rawkey|rawdek|dekbytes|secretvalue|apitoken|accesstoken|authorization";

function isRedactedValueCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "Redacted" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "value"
  );
}

/** Enforces no secret material in logs through ESLint-compatible AST visitors. */
export const noSecretMaterialInLogs = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Redacted.value(...) unwraps and secret-named identifiers inside Effect logging and span annotation arguments",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
          denyPattern: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      redactedUnwrap:
        "Never unwrap a Redacted value inside a log or span argument. Log identifiers (document_id, job_id), never secret material.",
      secretIdentifier:
        '"{{name}}" looks like secret material and must not appear in log or span arguments. Log identifiers (document_id, job_id), never plaintext or credentials.',
    },
  },
  create(context) {
    const denyPattern = new RegExp(context.options[0]?.denyPattern ?? DEFAULT_DENY_PATTERN, "u");

    const allowedNames = new Set(
      (context.options[0]?.allow ?? []).map((name) => name.toLowerCase().replaceAll("_", "")),
    );

    function isDeniedName(name) {
      const normalized = name.toLowerCase().replaceAll("_", "");

      if (allowedNames.has(normalized)) {
        return false;
      }

      return denyPattern.test(normalized);
    }

    function checkArgument(argument) {
      walkLintAst(argument, (node) => {
        if (isRedactedValueCall(node)) {
          context.report({ node, messageId: "redactedUnwrap" });
          return false;
        }

        if (node.type === "Identifier" && isDeniedName(node.name)) {
          context.report({ node, messageId: "secretIdentifier", data: { name: node.name } });
          return true;
        }

        if (
          node.type === "Property" &&
          node.key.type === "Literal" &&
          typeof node.key.value === "string" &&
          isDeniedName(node.key.value)
        ) {
          context.report({
            node: node.key,
            messageId: "secretIdentifier",
            data: { name: node.key.value },
          });

          return true;
        }

        return true;
      });
    }

    return {
      CallExpression(node) {
        if (!isEffectApiMember(node.callee, LOGGING_METHODS)) {
          return;
        }

        const isWithSpan =
          node.callee.property.type === "Identifier" && node.callee.property.name === "withSpan";

        const argumentsToCheck = isWithSpan ? node.arguments.slice(1) : node.arguments;

        for (const argument of argumentsToCheck) {
          checkArgument(argument);
        }
      },
    };
  },
};
