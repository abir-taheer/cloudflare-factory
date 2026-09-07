import { OpenAPIHono } from "@hono/zod-openapi";
import { Effect } from "effect";
import { ApiAuthentication } from "./api-authentication.js";
import type { ApiHonoEnvironment } from "./api-context.js";
import { apiErrorBody, apiHttpStatus } from "./api-errors.js";
import { registerApiOpenapiRoute } from "../routes/openapi/get.js";
import {
  apiCorsMiddleware,
  apiMethodMiddleware,
  apiSecurityMiddleware,
  apiSessionMiddleware,
} from "./api-middleware.js";
import { apiRequestBodyMiddleware } from "./api-request-body.js";
import { runApiEffect } from "./run-route-effect.js";
import { registerApiBusinessRoutes, registerApiHealthRoutes } from "./api-route-registration.js";

/** One router serves Node and Workers and generates the client contract without configuration. */
export const createApiApplication = () => {
  const application = new OpenAPIHono<ApiHonoEnvironment>();

  application.use("*", apiSecurityMiddleware, apiCorsMiddleware);
  registerApiHealthRoutes(application);

  application.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });

  registerApiOpenapiRoute(application);

  application.on(["GET", "POST"], "/api/auth/*", (context) => {
    const authenticationEffect = Effect.gen(function* () {
      const authentication = yield* ApiAuthentication;
      return yield* authentication.handleRequest(context.req.raw);
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          context.json(
            apiErrorBody(context, "Authentication unavailable", "AUTH_UNAVAILABLE", true),
            apiHttpStatus.unavailable,
          ),
        ),
      ),
    );

    return runApiEffect(context, authenticationEffect);
  });

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
