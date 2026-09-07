import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import { ApiAuthentication } from "./api-authentication.js";
import type { ApiHonoEnvironment } from "./api-context.js";
import { apiErrorBody, apiHttpStatus } from "./api-errors.js";
import { runApiEffect } from "./run-route-effect.js";

const supportedApiMethods = ["GET", "POST"];
const supportedApiHeaders = ["authorization", "content-type"];

/** Security headers apply to success, errors, auth and preflight responses alike. */
export const apiSecurityMiddleware: MiddlewareHandler<ApiHonoEnvironment> = async (
  context,
  next,
) => {
  context.set("requestId", crypto.randomUUID());
  context.header("x-request-id", context.get("requestId"));
  context.header("cache-control", "no-store");
  context.header("x-content-type-options", "nosniff");
  context.header("referrer-policy", "no-referrer");
  return next();
};

/** Exact origins permit credentialed browser calls; preflight never requires a session. */
export const apiCorsMiddleware: MiddlewareHandler<ApiHonoEnvironment> = async (context, next) => {
  const origin = context.req.header("origin");
  context.header("vary", "Origin");

  if (origin !== undefined) {
    const isAllowedOrigin = context.env.configuration.frontendOrigins.includes(origin);

    if (!isAllowedOrigin) {
      return context.json(
        apiErrorBody(context, "Origin not allowed", "ORIGIN_NOT_ALLOWED"),
        apiHttpStatus.forbidden,
      );
    }

    context.header("access-control-allow-origin", origin);
    context.header("access-control-allow-credentials", "true");
    context.header("access-control-expose-headers", "x-request-id");
  }

  if (context.req.method === "OPTIONS") {
    const method = context.req.header("access-control-request-method");

    const headers =
      context.req
        .header("access-control-request-headers")
        ?.toLowerCase()
        .split(",")
        .map((header) => header.trim()) ?? [];

    const isAllowedMethod = method !== undefined && supportedApiMethods.includes(method);
    const hasAllowedHeaders = headers.every((header) => supportedApiHeaders.includes(header));
    const isAllowedPreflight = origin !== undefined && isAllowedMethod && hasAllowedHeaders;

    if (!isAllowedPreflight) {
      return context.json(
        apiErrorBody(context, "Preflight not allowed", "PREFLIGHT_NOT_ALLOWED"),
        apiHttpStatus.forbidden,
      );
    }

    context.header("access-control-allow-methods", supportedApiMethods.join(", "));
    context.header("access-control-allow-headers", supportedApiHeaders.join(", "));
    context.header("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
    return context.body(null, apiHttpStatus.noContent);
  }

  return next();
};

/** Only verified session identity reaches owner-scoped business operations. */
export const apiSessionMiddleware: MiddlewareHandler<ApiHonoEnvironment> = async (
  context,
  next,
) => {
  const sessionEffect = Effect.gen(function* () {
    const authentication = yield* ApiAuthentication;
    return yield* authentication.resolveSession(context.req.raw.headers);
  });

  const result = await runApiEffect(context, Effect.result(sessionEffect));

  if (result._tag === "Failure") {
    return context.json(
      apiErrorBody(context, "Authentication unavailable", "AUTH_UNAVAILABLE", true),
      apiHttpStatus.unavailable,
    );
  }

  if (result.success === null) {
    return context.json(
      apiErrorBody(context, "Unauthorized", "UNAUTHORIZED"),
      apiHttpStatus.unauthorized,
    );
  }

  if (!result.success.user.emailVerified) {
    return context.json(
      apiErrorBody(context, "Email verification required", "EMAIL_VERIFICATION_REQUIRED"),
      apiHttpStatus.forbidden,
    );
  }

  context.set("sessionUser", result.success.user);
  return next();
};

/** Unsupported methods retain an explicit JSON response after session authorization. */
export const apiMethodMiddleware: MiddlewareHandler<ApiHonoEnvironment> = (context, next) => {
  const isSupportedMethod = supportedApiMethods.includes(context.req.method);

  if (!isSupportedMethod) {
    return Promise.resolve(
      context.json(
        apiErrorBody(context, "Method not allowed", "METHOD_NOT_ALLOWED"),
        apiHttpStatus.methodNotAllowed,
      ),
    );
  }

  return next();
};
