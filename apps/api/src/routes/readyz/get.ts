import { apiHttpStatus } from "../../http/api_errors.js";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Effect } from "effect";
import { Database, Queue } from "@factory/platform";
import type { ApiHonoEnvironment } from "../../http/api_context.js";
import { apiErrorResponses, apiJsonContent } from "../../http/api_openapi.js";
import { runRouteEffect } from "../../http/run_route_effect.js";

const ApiReadinessSchema = z
  .object({ status: z.literal("ready"), queue: z.literal("configured") })
  .openapi("ApiReadiness");

const route = createRoute({
  method: "get",
  path: "/readyz",
  operationId: "getApiReadiness",
  security: [],
  responses: {
    200: apiJsonContent(ApiReadinessSchema, "Database schema reachable and queue configured"),
    404: apiErrorResponses[apiHttpStatus.unavailable],
    ...apiErrorResponses,
  },
});

/** Readiness queries the migrated database without creating notes or enqueueing work. */
export const apiReadinessRoute = new OpenAPIHono<ApiHonoEnvironment>().openapi(route, (context) =>
  runRouteEffect(
    context,
    Effect.gen(function* () {
      const database = yield* Database;

      yield* Queue;
      yield* database.health();
      return context.json({ status: "ready", queue: "configured" }, apiHttpStatus.ok);
    }),
    "api.readiness",
  ),
);
