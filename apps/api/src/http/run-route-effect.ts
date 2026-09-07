import { Effect, Match } from "effect";
import type { Context } from "hono";
import type { CapabilityError } from "@factory/platform";
import type { ApiHonoEnvironment, ApiServices } from "./api-context.js";
import { type ApiNotFoundError, apiErrorBody, apiHttpStatus } from "./api-errors.js";

type ApiRouteFailure = CapabilityError | ApiNotFoundError;

/** Shared HTTP execution uses the borrowed runtime services and combined abort signal. */
export const runApiEffect = <A, E>(
  context: Context<ApiHonoEnvironment>,
  effect: Effect.Effect<A, E, ApiServices>,
) => {
  const runRequest = Effect.runPromiseWith(context.env.services);
  return runRequest(effect, { signal: context.env.signal });
};

const apiFailureResponse = (context: Context<ApiHonoEnvironment>, error: ApiRouteFailure) =>
  Match.value(error).pipe(
    Match.tag("ApiNotFoundError", (failure) =>
      context.json(apiErrorBody(context, failure.message, "NOT_FOUND"), apiHttpStatus.notFound),
    ),
    Match.tag("CapabilityError", () =>
      context.json(
        apiErrorBody(context, "Provider unavailable", "PROVIDER_UNAVAILABLE", true),
        apiHttpStatus.unavailable,
      ),
    ),
    Match.exhaustive,
  );

/** Only the HTTP boundary executes business effects; spans contain stable operation names. */
export const runRouteEffect = <A>(
  context: Context<ApiHonoEnvironment>,
  effect: Effect.Effect<A, ApiRouteFailure, ApiServices>,
  operation: string,
) => {
  const requestEffect = effect.pipe(
    Effect.tapError((error) =>
      Effect.logWarning("API operation failed").pipe(
        Effect.annotateLogs({
          operation,
          category: error._tag,
          requestId: context.get("requestId"),
        }),
      ),
    ),
    Effect.withSpan(operation),
    Effect.catch((error) => Effect.succeed(apiFailureResponse(context, error))),
  );

  return runApiEffect(context, requestEffect);
};
