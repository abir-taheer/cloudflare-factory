import { noDbMocks } from "./rules/testing/no_db_mocks.mjs";
import { noErrorMessageAssertions } from "./rules/testing/no_error_message_assertions.mjs";
import { noErrorMessageExpectations } from "./rules/testing/no_error_message_expectations.mjs";
import { preferPartialDeepStrictEqual } from "./rules/testing/prefer_partial_deep_strict_equal.mjs";
import { noInlineGenericObjectTypes } from "./rules/quality/no_inline_generic_object_types.mjs";
import { noTypeCasts } from "./rules/quality/no_type_casts.mjs";

/** Groups type and test lint rules without weakening individual rule enforcement. */
export const typeAndTestLintRules = {
  "no-db-mocks": noDbMocks,
  "no-error-message-assertions": noErrorMessageAssertions,
  "no-error-message-expectations": noErrorMessageExpectations,
  "prefer-partial-deep-strict-equal": preferPartialDeepStrictEqual,
  "no-inline-generic-object-types": noInlineGenericObjectTypes,
  "no-type-casts": noTypeCasts,
};
