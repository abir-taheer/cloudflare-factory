import { Data } from "effect";
import type { Context } from "hono";
import type { ApiHonoEnvironment } from "./api-context.js";

interface ApiNotFoundDetails {
  readonly message: "Not found" | "Note not found";
}

/** Domain absence is distinct from infrastructure failure. */
export class ApiNotFoundError extends Data.TaggedError("ApiNotFoundError")<ApiNotFoundDetails> {}

/** Named HTTP statuses preserve literal response types throughout route declarations. */
export const apiHttpStatus = Object.freeze({
  ok: 200,
  created: 201,
  accepted: 202,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  unavailable: 503,
});

/** Error envelopes preserve the demo error string and add sanitized diagnostic metadata. */
export const apiErrorBody = (
  context: Context<ApiHonoEnvironment>,
  error: string,
  code: string,
  retryable = false,
) => ({
  error,
  code,
  requestId: context.get("requestId"),
  retryable,
});
