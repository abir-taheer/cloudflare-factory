import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ApiHonoEnvironment } from "../../http/api_context.js";
import { apiDocumentConfiguration } from "../../http/api_openapi.js";

/** The kebab-case folder maps explicitly to the existing /openapi.json document URL. */
export const registerApiOpenapiRoute = (application: OpenAPIHono<ApiHonoEnvironment>) =>
  application.doc31("/openapi.json", apiDocumentConfiguration);
