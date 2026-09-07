import { noInlineZodInCreateRoute } from "../../rules/api/no_inline_zod_in_create_route.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-inline-zod-in-create-route", noInlineZodInCreateRoute, {
  valid: [
    `
      const GenerateDekRequestSchema = z.object({ section: z.enum(["credential"]) });
      const route = createRoute({
        method: "post",
        request: { body: jsonContent(GenerateDekRequestSchema, "Section") },
        responses: { 200: jsonContent(GenerateDekResponseSchema, "DEK envelope") },
      });
    `,
    "const StandaloneSchema = z.object({ id: z.string() });",
  ],
  invalid: [
    {
      code: `
        const route = createRoute({
          method: "post",
          request: { body: jsonContent(z.object({ section: z.string() }), "Section") },
        });
      `,
      errors: [{ messageId: "extractSchema" }],
    },
    {
      code: `
        const route = createRoute({
          responses: { 200: z.string().openapi({ description: "ok" }) },
        });
      `,
      errors: [{ messageId: "extractSchema" }],
    },
  ],
});
