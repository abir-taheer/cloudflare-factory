import { noErrorMessageAssertions } from "../../rules/testing/no-error-message-assertions.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-error-message-assertions", noErrorMessageAssertions, {
  valid: [
    'assert.equal(result.left._tag, "AuthenticationError");',
    "assert.deepEqual(response, { success: false });",
    'assert.ok(logs.some((log) => log.message === "audit.operation"));',
    "const text = failure.message;",
  ],
  invalid: [
    {
      code: 'assert.ok(result.left.message.includes("active_kid"));',
      errors: [{ messageId: "assertOnTag" }],
    },
    {
      code: 'assert.equal(error.reason, "invalid envelope");',
      errors: [{ messageId: "assertOnTag" }],
    },
    {
      code: "assert.match(caught.message, /denied/);",
      errors: [{ messageId: "assertOnTag" }],
    },
  ],
});
