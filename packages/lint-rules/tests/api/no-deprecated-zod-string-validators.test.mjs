import { noDeprecatedZodStringValidators } from "../../rules/api/no-deprecated-zod-string-validators.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-deprecated-zod-string-validators", noDeprecatedZodStringValidators, {
  valid: [
    "const UrlSchema = z.url();",
    "const SegmentSchema = z.base64url().min(1);",
    "const NameSchema = z.string().min(1).max(64);",
    "const DateSchema = z.iso.date();",
    "const TokenSchema = z.jwt();",
  ],
  invalid: [
    {
      code: "const IdSchema = z.string().uuid();",
      errors: [
        { messageId: "useTopLevelValidator", data: { method: "uuid", replacement: "z.uuid()" } },
      ],
    },
    {
      code: "const LinkSchema = z.string().min(1).url();",
      errors: [
        { messageId: "useTopLevelValidator", data: { method: "url", replacement: "z.url()" } },
      ],
    },
    {
      code: "const StampSchema = z.string().datetime();",
      errors: [
        {
          messageId: "useTopLevelValidator",
          data: { method: "datetime", replacement: "z.iso.datetime()" },
        },
      ],
    },
  ],
});
