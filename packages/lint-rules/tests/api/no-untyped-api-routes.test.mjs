import { noUntypedApiRoutes } from "../../rules/api/no-untyped-api-routes.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-untyped-api-routes", noUntypedApiRoutes, {
  valid: [
    'cache.get("/notes");',
    'app.openapi(NoteCreateRoute, (context) => context.json({ id: "note" }, 201));',
    'context.get("requestId");',
    'headers.get("authorization");',
    'app.use("/*", authentication);',
  ],
  invalid: [
    { code: 'app.on("GET", "/notes", handler);', errors: [{ messageId: "useOpenApi" }] },
    { code: 'app.all("*", handler);', errors: [{ messageId: "useOpenApi" }] },
    { code: 'app.post("/notes", handler);', errors: [{ messageId: "useOpenApi" }] },
    { code: 'app["get"]("/notes/{id}", handler);', errors: [{ messageId: "useOpenApi" }] },
    {
      code: 'app.get("/healthz", (context) => context.json({ ok: true }));',
      errors: [{ messageId: "useOpenApi" }],
    },
  ],
});
