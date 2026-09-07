import {
  AcceptedJobSchema,
  ApiErrorSchema,
  ApiHealthSchema,
  ApiNoteSchema,
  CompletedJobSchema,
  PendingJobSchema,
} from "@factory/api-contract/schema";
import type { Middleware } from "openapi-fetch";

/** Public API failures contain only the server's documented safe envelope. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const responseSchemas = {
  "/healthz": ApiHealthSchema,
  "/api/v1/notes": ApiNoteSchema,
  "/api/v1/notes/{id}": ApiNoteSchema,
  "/api/v1/jobs": AcceptedJobSchema,
  "/api/v1/jobs/{id}": CompletedJobSchema.or(PendingJobSchema),
};

/** Validate wire responses with the same canonical schemas used to publish OpenAPI. */
export const apiResponseValidation: Middleware = {
  async onResponse({ schemaPath, response }) {
    const value: unknown = await response.clone().json();

    if (!response.ok) {
      const failure = ApiErrorSchema.safeParse(value);

      if (!failure.success) {
        throw new ApiClientError("The API returned an unexpected error.");
      }

      throw new ApiClientError(failure.data.error, failure.data.retryable);
    }

    for (const [path, schema] of Object.entries(responseSchemas)) {
      if (path === schemaPath && !schema.safeParse(value).success) {
        throw new ApiClientError("The API returned an invalid response.");
      }
    }
  },
};
