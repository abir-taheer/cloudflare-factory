import { oneCreateRoutePerFile } from "../../rules/api/one_create_route_per_file.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("one-create-route-per-file", oneCreateRoutePerFile, {
  valid: [
    'const route = createRoute({ method: "post", path: "/" });',
    "const app = new OpenAPIHono();",
  ],
  invalid: [
    {
      code: `
        const generateRoute = createRoute({ method: "post", path: "/" });
        const listRoute = createRoute({ method: "get", path: "/" });
      `,
      errors: [{ messageId: "oneRoutePerFile" }],
    },
  ],
});
