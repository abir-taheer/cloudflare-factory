import { apiHttpStatus } from "../../../../../http/api-errors.js";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { Effect } from "effect";
import type { ApiHonoEnvironment } from "../../../../../http/api-context.js";
import { ApiErrorSchema, ApiIdParamsSchema, ApiNoteSchema } from "@factory/api-contract/schema";
import {
  apiErrorResponses,
  apiJsonContent,
  apiValidationHook,
} from "../../../../../http/api-openapi.js";
import { runRouteEffect } from "../../../../../http/run-route-effect.js";
import { getApiNote } from "../../../../../services/note-operations.js";

const route = createRoute({
  method: "get",
  path: "/api/v1/notes/{id}",
  operationId: "getNote",
  security: [{ sessionCookie: [] }],
  request: { params: ApiIdParamsSchema },
  responses: {
    200: apiJsonContent(ApiNoteSchema, "Stored note"),
    404: apiJsonContent(ApiErrorSchema, "Not found"),
    ...apiErrorResponses,
  },
});

/** Invalid and absent notes retain the same public not-found response. */
export const apiNoteGetRoute = new OpenAPIHono<ApiHonoEnvironment>({
  defaultHook: apiValidationHook("Not found"),
}).openapi(route, (context) =>
  runRouteEffect(
    context,
    getApiNote(context.req.valid("param").id, context.get("sessionUser").id).pipe(
      Effect.map((note) => context.json(note, apiHttpStatus.ok)),
    ),
    "api.notes.get",
  ),
);
