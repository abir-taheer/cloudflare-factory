import { apiHttpStatus } from "../../http/api-errors.js";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ApiHealthSchema } from "@factory/api-contract/schema";
import type { ApiHonoEnvironment } from "../../http/api-context.js";
import { apiJsonContent } from "../../http/api-openapi.js";

const route = createRoute({
  method: "get",
  path: "/healthz",
  operationId: "getHealth",
  security: [],
  responses: { 200: apiJsonContent(ApiHealthSchema, "API process health") },
});

/** Public liveness never queries provider dependencies. */
export const apiHealthRoute = new OpenAPIHono<ApiHonoEnvironment>().openapi(route, (context) =>
  context.json(
    { status: "ok", environment: context.env.configuration.environment },
    apiHttpStatus.ok,
  ),
);
