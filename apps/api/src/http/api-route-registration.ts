import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ApiHonoEnvironment } from "./api-context.js";
import { apiReadinessRoute } from "../routes/readyz/get.js";
import { apiHealthRoute } from "../routes/healthz/get.js";
import { apiNoteCreateRoute } from "../routes/api/v1/notes/post.js";
import { apiNoteGetRoute } from "../routes/api/v1/notes/[id]/get.js";
import { apiJobCreateRoute } from "../routes/api/v1/jobs/post.js";
import { apiJobGetRoute } from "../routes/api/v1/jobs/[id]/get.js";

/** Public health routes are registered before the authenticated application middleware. */
export const registerApiHealthRoutes = (application: OpenAPIHono<ApiHonoEnvironment>) =>
  application.route("/", apiHealthRoute).route("/", apiReadinessRoute);

/** Business routes retain their individual OpenAPI schemas and registration order. */
export const registerApiBusinessRoutes = (application: OpenAPIHono<ApiHonoEnvironment>) =>
  application
    .route("/", apiNoteCreateRoute)
    .route("/", apiNoteGetRoute)
    .route("/", apiJobCreateRoute)
    .route("/", apiJobGetRoute);
