import { noSecretMaterialInLogs } from "../../rules/security/no_secret_material_in_logs.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-secret-material-in-logs", noSecretMaterialInLogs, {
  valid: [
    'const line = Effect.logInfo("Encrypted secret");',
    'const annotated = Effect.annotateLogs("job.document_id", documentId);',
    "const unwrapped = Redacted.value(config.apiToken);",
    'const spanned = Effect.withSpan("docx.convert", { attributes: { job_id: jobId } });',
    'const line = Effect.logInfo("Exchange body returned as plaintext (no credential detected)");',
    {
      code: 'const line = Effect.annotateLogs("exchange.plaintext_paths", encrypted.plaintextPaths);',
      options: [{ allow: ["plaintextPaths"] }],
    },
  ],
  invalid: [
    { code: "Effect.logInfo(apiToken);", errors: [{ messageId: "secretIdentifier" }] },
    {
      code: 'const line = Effect.annotateLogs("kms.dek", Redacted.value(dek));',
      errors: [{ messageId: "redactedUnwrap" }],
    },
    {
      code: "const line = Effect.logDebug(`imported key: ${plaintextKey}`);",
      errors: [{ messageId: "secretIdentifier" }],
    },
    {
      code: "const line = Effect.annotateLogs({ plaintext_key: material });",
      errors: [{ messageId: "secretIdentifier" }],
    },
    {
      code: 'const spanned = Effect.withSpan("auth", { attributes: { password } });',
      errors: [{ messageId: "secretIdentifier" }],
    },
    {
      code: "const line = Effect.logInfo(config.secretAccessKey);",
      errors: [{ messageId: "secretIdentifier" }],
    },
  ],
});
