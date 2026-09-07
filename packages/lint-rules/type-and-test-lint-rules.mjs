import { noDbMocks } from "./rules/testing/no-db-mocks.mjs";
import { noErrorMessageAssertions } from "./rules/testing/no-error-message-assertions.mjs";
import { noErrorMessageExpectations } from "./rules/testing/no-error-message-expectations.mjs";
import { preferPartialDeepStrictEqual } from "./rules/testing/prefer-partial-deep-strict-equal.mjs";
import { noInlineGenericObjectTypes } from "./rules/quality/no-inline-generic-object-types.mjs";
import { noTypeCasts } from "./rules/quality/no-type-casts.mjs";

/** Groups type and test lint rules without weakening individual rule enforcement. */
export const typeAndTestLintRules = {
  "no-db-mocks": noDbMocks,
  "no-error-message-assertions": noErrorMessageAssertions,
  "no-error-message-expectations": noErrorMessageExpectations,
  "prefer-partial-deep-strict-equal": preferPartialDeepStrictEqual,
  "no-inline-generic-object-types": noInlineGenericObjectTypes,
  "no-type-casts": noTypeCasts,
};
