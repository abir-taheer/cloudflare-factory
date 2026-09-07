import type { Hook, z } from "@hono/zod-openapi";
import type { ApiHonoEnvironment } from "./api_context.js";
import { apiErrorBody, apiHttpStatus } from "./api_errors.js";
import { ApiErrorSchema } from "@factory/api-contract/schema";

/** JSON content retains the concrete schema for inferred response types. */
export const apiJsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

/** Protected routes share the same documented middleware errors. */
export const apiErrorResponses = {
  401: apiJsonContent(ApiErrorSchema, "Unauthorized"),
  403: apiJsonContent(ApiErrorSchema, "Origin not allowed"),
  405: apiJsonContent(ApiErrorSchema, "Method not allowed"),
  503: apiJsonContent(ApiErrorSchema, "Service or provider unavailable"),
};

/** Every POST route shares the bounded JSON request contract. */
export const apiBodyErrorResponses = {
  ...apiErrorResponses,
  400: apiJsonContent(ApiErrorSchema, "Invalid request"),
  413: apiJsonContent(ApiErrorSchema, "Request body too large"),
  415: apiJsonContent(ApiErrorSchema, "JSON required"),
};

/** Validation returns route-specific messages without echoing input or Zod issues. */
export const apiValidationHook = (
  message: string,
): Hook<unknown, ApiHonoEnvironment, string, unknown> =>
  function validateRouteInput(result, context) {
    if (result.success) {
      return null;
    }

    const status = result.target === "param" ? apiHttpStatus.notFound : apiHttpStatus.badRequest;
    const errorCode = status === apiHttpStatus.notFound ? "NOT_FOUND" : "VALIDATION_ERROR";

    return context.json(apiErrorBody(context, message, errorCode), status);
  };

/** OpenAPI is generated from the live route declarations without provider connections. */
export const apiDocumentConfiguration = {
  openapi: "3.1.0",
  info: { title: "Factory API", version: "0.1.0" },
};
