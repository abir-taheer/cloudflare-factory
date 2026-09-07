import { apiHttpStatus } from "../../../../http/api_errors.js";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ApiNoteSchema, CreateNoteSchema } from "@factory/api-contract/schema";
import { Effect } from "effect";
import type { ApiHonoEnvironment } from "../../../../http/api_context.js";
import {
  apiBodyErrorResponses,
  apiJsonContent,
  apiValidationHook,
} from "../../../../http/api_openapi.js";
import { runRouteEffect } from "../../../../http/run_route_effect.js";
import { createApiNote } from "../../../../services/note_operations.js";

const route = createRoute({
  method: "post",
  path: "/api/v1/notes",
  operationId: "createNote",
  security: [{ sessionCookie: [] }],
  request: { body: { ...apiJsonContent(CreateNoteSchema, "Note content"), required: true } },
  responses: {
    201: apiJsonContent(ApiNoteSchema, "Created note"),
    404: apiBodyErrorResponses[apiHttpStatus.badRequest],
    ...apiBodyErrorResponses,
  },
});

/** Creation validates input before entering the portable note operation. */
export const apiNoteCreateRoute = new OpenAPIHono<ApiHonoEnvironment>({
  defaultHook: apiValidationHook("Content must contain 1–4000 characters"),
}).openapi(route, (context) =>
  runRouteEffect(
    context,
    createApiNote(context.req.valid("json").content, context.get("sessionUser").id).pipe(
      Effect.map((note) => context.json(note, apiHttpStatus.created)),
    ),
    "api.notes.create",
  ),
);
