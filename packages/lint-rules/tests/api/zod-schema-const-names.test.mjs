import { zodSchemaConstNames } from "../../rules/api/zod-schema-const-names.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("zod-schema-const-names", zodSchemaConstNames, {
  valid: [
    "const UploadRequestSchema = z.object({});",
    "const Base64StringSchema = z.base64();",
    "const parseResult = BearerTokenSchema.safeParse(header);",
    "const validated = z.uuid().safeParse(input);",
    "const adapters = buildAdapters();",
  ],
  invalid: [
    {
      code: "const Base64UrlSegment = z.base64url().min(1);",
      errors: [
        {
          messageId: "schemaSuffix",
          data: { name: "Base64UrlSegment", suggestion: "Base64UrlSegmentSchema" },
        },
      ],
    },
    {
      code: "const bearerToken = z.string().startsWith('Bearer ');",
      errors: [
        {
          messageId: "schemaSuffix",
          data: { name: "bearerToken", suggestion: "BearerTokenSchema" },
        },
      ],
    },
    {
      code: "const userSchema = z.object({ id: z.string() });",
      errors: [
        { messageId: "schemaSuffix", data: { name: "userSchema", suggestion: "UserSchema" } },
      ],
    },
  ],
});
