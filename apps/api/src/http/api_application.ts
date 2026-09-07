import { OpenAPIHono } from "@hono/zod-openapi";
import type { ApiHonoEnvironment } from "./api_context.js";
import { apiErrorBody, apiHttpStatus } from "./api_errors.js";
import { registerApiOpenapiRoute } from "../routes/openapi/get.js";
import { apiAuthenticationHandler } from "../routes/api/auth/authentication_handler.js";
import {
  apiCorsMiddleware,
  apiMethodMiddleware,
  apiSecurityMiddleware,
  apiSessionMiddleware,
} from "./api_middleware.js";
import { apiBodyLimitMiddleware, apiRequestBodyMiddleware } from "./api_request_body.js";
import { registerApiBusinessRoutes, registerApiHealthRoutes } from "./api_route_registration.js";

/** One router serves Node and Workers and generates the client contract without configuration. */
export const createApiApplication = () => {
  const application = new OpenAPIHono<ApiHonoEnvironment>();

  application.use("*", apiSecurityMiddleware, apiCorsMiddleware);
  application.use("/api/*", apiBodyLimitMiddleware);
  registerApiHealthRoutes(application);

  application.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });

  registerApiOpenapiRoute(application);

  application.on(["GET", "POST"], "/api/auth/*", apiAuthenticationHandler);

  application.use("/api/v1/*", apiSessionMiddleware, apiMethodMiddleware, apiRequestBodyMiddleware);
  registerApiBusinessRoutes(application);

  application.notFound((context) =>
    context.json(apiErrorBody(context, "Not found", "NOT_FOUND"), apiHttpStatus.notFound),
  );

  application.onError((_error, context) =>
    context.json(
      apiErrorBody(context, "Provider unavailable", "PROVIDER_UNAVAILABLE", true),
      apiHttpStatus.unavailable,
    ),
  );

  return application;
};
