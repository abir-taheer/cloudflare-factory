import { apiHttpStatus } from "../../../../http/api_errors.js";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { AcceptedJobSchema, ApiErrorSchema, CreateJobSchema } from "@factory/api-contract/schema";
import { Effect } from "effect";
import type { ApiHonoEnvironment } from "../../../../http/api_context.js";
import {
  apiBodyErrorResponses,
  apiJsonContent,
  apiValidationHook,
} from "../../../../http/api_openapi.js";
import { runRouteEffect } from "../../../../http/run_route_effect.js";
import { createApiJob } from "../../../../services/job_operations.js";

const route = createRoute({
  method: "post",
  path: "/api/v1/jobs",
  operationId: "createJob",
  security: [{ sessionCookie: [] }],
  request: { body: { ...apiJsonContent(CreateJobSchema, "Note to process"), required: true } },
  responses: {
    202: apiJsonContent(AcceptedJobSchema, "Accepted job"),
    404: apiJsonContent(ApiErrorSchema, "Note not found"),
    ...apiBodyErrorResponses,
  },
});

/** Accepted jobs retain the existing pending response and missing-note error. */
export const apiJobCreateRoute = new OpenAPIHono<ApiHonoEnvironment>({
  defaultHook: apiValidationHook("Valid noteId required"),
}).openapi(route, (context) =>
  runRouteEffect(
    context,
    createApiJob(context.req.valid("json").noteId, context.get("sessionUser").id).pipe(
      Effect.map((job) => AcceptedJobSchema.parse({ ...job, status: "pending" })),
      Effect.map((response) => context.json(response, apiHttpStatus.accepted)),
    ),
    "api.jobs.create",
  ),
);
