import { Effect, Result } from "effect";
import { ApiClientError } from "@factory/api-client/http";

const maximumQueryRetries = 2;

/** Reference-style Effect transport boundary preserves typed failures for React Query. */
export async function runFrontendRequest<A>(request: () => Promise<A>): Promise<A> {
  const operation = Effect.tryPromise({
    try: request,
    catch: (cause) => {
      if (cause instanceof ApiClientError) {
        return cause;
      }

      return new ApiClientError("The request could not be completed.", null);
    },
  });

  // eslint-disable-next-line factory/no-effect-run -- Browser promise boundary consumed by TanStack Query.
  const result = await Effect.runPromise(
    Effect.result(operation.pipe(Effect.withSpan("FrontendApi"))),
  );

  if (Result.isFailure(result)) {
    throw result.failure;
  }

  return result.success;
}

/** Retry only transient API query failures, never mutations or authentication errors. */
export function shouldRetryApiRequest(failureCount: number, error: unknown): boolean {
  return failureCount < maximumQueryRetries && error instanceof ApiClientError && error.retryable;
}
