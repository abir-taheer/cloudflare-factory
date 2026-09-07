import { noReannotatedAuthContext } from "../../rules/api/no_reannotated_auth_context.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-reannotated-auth-context", noReannotatedAuthContext, {
  valid: [
    'const line = Effect.annotateLogs("kms.section", section);',
    'const line = Effect.annotateLogs({ "kms.toolkit": toolkit, "http.status": status });',
    'const line = Effect.annotateLogs("auth.failure_message", failure);',
  ],
  invalid: [
    {
      code: 'const line = Effect.annotateLogs("auth.subject", subject);',
      errors: [{ messageId: "reservedKey" }],
    },
    {
      code: 'const line = Effect.annotateLogs({ "http.request_id": requestId });',
      errors: [{ messageId: "reservedKey" }],
    },
    {
      code: 'const line = Effect.annotateLogs({ "auth.token_id": tokenId, "auth.toolkit_scope": scope });',
      errors: [{ messageId: "reservedKey" }, { messageId: "reservedKey" }],
    },
  ],
});
