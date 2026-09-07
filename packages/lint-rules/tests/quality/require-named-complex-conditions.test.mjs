import { requireNamedComplexConditions } from "../../rules/quality/require-named-complex-conditions.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("require-named-complex-conditions", requireNamedComplexConditions, {
  valid: [
    'const isAllowedMethod = ["GET", "POST"].includes(context.req.method); if (!isAllowedMethod) { reject(); }',
    "if (isAllowedMethod(method)) { accept(); }",
    "if (allowedMethods.includes(context.req.method)) { accept(); }",
    'if (ready && context.req.method === "GET") { accept(); }',
    "if (values.some((value) => value.enabled)) { accept(); }",
    'if (values.some((value) => ["GET"].includes(value))) { accept(); }',
    "for (;;) { break; }",
    "while (hasNext()) { consume(); }",
    "const result = ready ? accept() : reject();",
  ],
  invalid: [
    {
      code: 'if (!["GET", "POST"].includes(context.req.method)) { reject(); }',
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: 'if (request.method.trim().toUpperCase() === "GET") { accept(); }',
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: 'if (ready && ["GET"].includes(method)) { accept(); }',
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: "while (queue.read().hasNext()) { consume(); }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: "do { consume(); } while (queue.read().hasNext());",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: "for (; queue.read().hasNext();) { consume(); }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: 'const result = ["GET"].includes(method) ? accept() : reject();',
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: "if (new Set(methods).has(method)) { accept(); }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      code: "if (request?.read()?.hasNext()) { accept(); }",
      errors: [{ messageId: "nameCondition" }],
    },
    { code: "if (matches({ method })) { accept(); }", errors: [{ messageId: "nameCondition" }] },
  ],
});
