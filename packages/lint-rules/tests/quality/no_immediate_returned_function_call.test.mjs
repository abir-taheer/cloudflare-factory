import { noImmediateReturnedFunctionCall } from "../../rules/quality/no_immediate_returned_function_call.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-immediate-returned-function-call", noImmediateReturnedFunctionCall, {
  valid: [
    'const outboundFetch = c.get("outboundFetch"); outboundFetch("https://provider.example");',
    'const callback = makeCallback("request"); callback("https://provider.example");',
    'const operation = Effect.fn("operation")(function* () {});',
    'class Service extends Context.Service("Service")<Service, ServiceShape>() {}',
    'class Service extends Context.Service<Service, ServiceShape>()("Service") {}',
  ],
  invalid: [
    {
      code: 'c.get("outboundFetch")("https://provider.example");',
      errors: [{ messageId: "nameReturnedFunction" }],
    },
    {
      code: 'makeCallback("request")("https://provider.example");',
      errors: [{ messageId: "nameReturnedFunction" }],
    },
    {
      code: "factory()<Callback>(argument);",
      errors: [{ messageId: "nameReturnedFunction" }],
    },
    {
      code: "(factory()<Callback>)(argument);",
      errors: [{ messageId: "nameReturnedFunction" }],
    },
  ],
});
