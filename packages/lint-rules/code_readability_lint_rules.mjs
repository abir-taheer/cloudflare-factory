import { noImmediateReturnedFunctionCall } from "./rules/quality/no_immediate_returned_function_call.mjs";
import { noInlineAwaitInArguments } from "./rules/quality/no_inline_await_in_arguments.mjs";
import { noInlineFallbackLambda } from "./rules/quality/no_inline_fallback_lambda.mjs";
import { noInlineObjectTypes } from "./rules/quality/no_inline_object_types.mjs";
import { noComplexTernary } from "./rules/quality/no_complex_ternary.mjs";
import { noUnnecessarySpread } from "./rules/quality/no_unnecessary_spread.mjs";
import { noUnjustifiedMultilineComments } from "./rules/quality/no_unjustified_multiline_comments.mjs";
import { requireBlankLinesBetweenStatementTypes } from "./rules/quality/require_blank_lines_between_statement_types.mjs";
import { requireNamedComplexConditions } from "./rules/quality/require_named_complex_conditions.mjs";

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
