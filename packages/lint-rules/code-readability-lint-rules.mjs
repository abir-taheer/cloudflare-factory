import { noImmediateReturnedFunctionCall } from "./rules/quality/no-immediate-returned-function-call.mjs";
import { noInlineAwaitInArguments } from "./rules/quality/no-inline-await-in-arguments.mjs";
import { noInlineFallbackLambda } from "./rules/quality/no-inline-fallback-lambda.mjs";
import { noInlineObjectTypes } from "./rules/quality/no-inline-object-types.mjs";
import { noComplexTernary } from "./rules/quality/no-complex-ternary.mjs";
import { noUnnecessarySpread } from "./rules/quality/no-unnecessary-spread.mjs";
import { noUnjustifiedMultilineComments } from "./rules/quality/no-unjustified-multiline-comments.mjs";
import { requireBlankLinesBetweenStatementTypes } from "./rules/quality/require-blank-lines-between-statement-types.mjs";
import { requireNamedComplexConditions } from "./rules/quality/require-named-complex-conditions.mjs";

/** Groups code readability lint rules without weakening individual rule enforcement. */
export const codeReadabilityLintRules = {
  "no-immediate-returned-function-call": noImmediateReturnedFunctionCall,
  "no-inline-await-in-arguments": noInlineAwaitInArguments,
  "no-inline-fallback-lambda": noInlineFallbackLambda,
  "no-inline-object-types": noInlineObjectTypes,
  "no-complex-ternary": noComplexTernary,
  "no-unnecessary-spread": noUnnecessarySpread,
  "no-unjustified-multiline-comments": noUnjustifiedMultilineComments,
  "require-blank-lines-between-statement-types": requireBlankLinesBetweenStatementTypes,
  "require-named-complex-conditions": requireNamedComplexConditions,
};
