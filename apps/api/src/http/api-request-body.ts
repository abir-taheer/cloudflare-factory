import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import type { ApiHonoEnvironment } from "./api-context.js";
import { apiErrorBody, apiHttpStatus } from "./api-errors.js";
import { runApiEffect } from "./run-route-effect.js";

const maximumApiBodyBytes = 16_384;

const readBoundedApiBody = (request: Request) =>
  Effect.gen(function* () {
    const reader = request.body?.getReader();

    if (!reader) {
      return "";
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    for (;;) {
      const chunk = yield* Effect.tryPromise(() => reader.read());

      if (chunk.done) {
        break;
      }

      if (!(chunk.value instanceof Uint8Array)) {
        return null;
      }

      size += chunk.value.byteLength;

      if (size > maximumApiBodyBytes) {
        yield* Effect.tryPromise(() => reader.cancel());
        return null;
      }

      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(bytes);
  });

/** Stream bytes are bounded before Hono parses JSON, including requests without content length. */
export const apiRequestBodyMiddleware: MiddlewareHandler<ApiHonoEnvironment> = async (
  context,
  next,
) => {
  if (context.req.method !== "POST") {
    return next();
  }

  const isJsonRequest = context.req.header("content-type")?.startsWith("application/json") === true;

  if (!isJsonRequest) {
    return context.json(
      apiErrorBody(context, "JSON required", "JSON_REQUIRED"),
      apiHttpStatus.unsupportedMediaType,
    );
  }

  const body = await runApiEffect(
    context,
    readBoundedApiBody(context.req.raw).pipe(Effect.catch(() => Effect.succeed(null))),
  );

  if (body === null) {
    return context.json(
      apiErrorBody(context, "Request body too large", "BODY_TOO_LARGE"),
      apiHttpStatus.payloadTooLarge,
    );
  }

  // Hono's public cache lets route validators reuse the bounded parse without rereading the stream.
  const parsed = Effect.try((): unknown => JSON.parse(body)).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

  context.req.bodyCache.json = runApiEffect(context, parsed);
  return next();
};
