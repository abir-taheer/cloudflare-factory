import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiHonoEnvironment } from "./api_context.js";
import { apiErrorBody, apiHttpStatus } from "./api_errors.js";
import { runApiEffect } from "./run_route_effect.js";

const maximumApiBodyBytes = 16_384;

/** Bound every API body before parsing; Hono preserves the stream for Better Auth and validators. */
export const apiBodyLimitMiddleware: MiddlewareHandler<ApiHonoEnvironment> = (context, next) => {
  const limitRequestBody = bodyLimit({
    maxSize: maximumApiBodyBytes,
    onError: () =>
      context.json(
        apiErrorBody(context, "Request body too large", "BODY_TOO_LARGE"),
        apiHttpStatus.payloadTooLarge,
      ),
  });

  return limitRequestBody(context, next);
};

/** Business routes require JSON; Hono caches the bounded parse for the route's Zod validator. */
export const apiRequestBodyMiddleware: MiddlewareHandler<ApiHonoEnvironment> = async (
  context,
  next,
) => {
  if (context.req.method !== "POST") {
    return next();
  }

  const contentType = context.req.header("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  const isJsonRequest = mediaType === "application/json";

  if (!isJsonRequest) {
    return context.json(
      apiErrorBody(context, "JSON required", "JSON_REQUIRED"),
      apiHttpStatus.unsupportedMediaType,
    );
  }

  const parsed = await runApiEffect(
    context,
    Effect.tryPromise(() => context.req.json<unknown>()).pipe(Effect.result),
  );

  if (parsed._tag === "Failure") {
    return context.json(
      apiErrorBody(context, "Invalid JSON", "INVALID_JSON"),
      apiHttpStatus.badRequest,
    );
  }

  return next();
};
