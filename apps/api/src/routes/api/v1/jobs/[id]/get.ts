import { apiHttpStatus } from "../../../../../http/api-errors.js";
import { OpenAPIHono, createRoute, type z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  ApiIdParamsSchema,
  CompletedJobSchema,
  PendingJobSchema,
} from "@factory/api-contract/schema";
import { Effect } from "effect";
import type { ApiHonoEnvironment } from "../../../../../http/api-context.js";
import {
  apiErrorResponses,
  apiJsonContent,
  apiValidationHook,
} from "../../../../../http/api-openapi.js";
import { runRouteEffect } from "../../../../../http/run-route-effect.js";
import { getApiJob } from "../../../../../services/job-operations.js";

const route = createRoute({
  method: "get",
  path: "/api/v1/jobs/{id}",
  operationId: "getJob",
  security: [{ sessionCookie: [] }],
  request: { params: ApiIdParamsSchema },
  responses: {
    200: apiJsonContent(CompletedJobSchema, "Completed job"),
    202: apiJsonContent(PendingJobSchema, "Job pending"),
    404: apiJsonContent(ApiErrorSchema, "Not found"),
    ...apiErrorResponses,
  },
});

/** Job results contain only public fields after owner authorization. */
export const apiJobGetRoute = new OpenAPIHono<ApiHonoEnvironment>({
  defaultHook: apiValidationHook("Not found"),
}).openapi(route, (context) => {
  const { id } = context.req.valid("param");

  return runRouteEffect(
    context,
    getApiJob(id, context.get("sessionUser").id).pipe(
      Effect.map((result) => {
        if (result === null) {
          const pendingJob: z.infer<typeof PendingJobSchema> = { id, status: "pending" };

          return context.json(pendingJob, apiHttpStatus.accepted);
        }

        return context.json(result, apiHttpStatus.ok);
      }),
    ),
    "api.jobs.get",
  );
});
