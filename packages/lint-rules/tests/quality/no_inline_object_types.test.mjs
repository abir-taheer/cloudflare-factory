import { noInlineObjectTypes } from "../../rules/quality/no_inline_object_types.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-inline-object-types", noInlineObjectTypes, {
  valid: [
    "type KeyMetadata = { id: string; createdAt: number };",
    "interface AdapterConfig { retry: { attempts: number } }",
    'class MiddlewareNextError extends Data.TaggedError("MiddlewareNextError")<{ readonly cause: unknown }> {}',
    "function describeKey(metadata: KeyMetadata): KeyMetadata { return metadata; }",
    "type Handler = (input: { raw: string }) => void;",
  ],
  invalid: [
    {
      code: "function describeKey(metadata: { id: string }) { return metadata.id; }",
      errors: [{ messageId: "nameTheType" }],
    },
    {
      code: "function check(): { ok: boolean } { return { ok: true }; }",
      errors: [{ messageId: "nameTheType" }],
    },
    {
      code: "const loaded: { id: string } = load();",
      errors: [{ messageId: "nameTheType" }],
    },
    {
      code: "function run(effect: Effect.Effect<string, { _tag: string; status: number }, never>) {}",
      errors: [{ messageId: "nameTheType" }],
    },
  ],
});
