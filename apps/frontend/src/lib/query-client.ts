import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@factory/api-client/http";

const maximumQueryRetries = 2;

const initialRetryDelayMs = 1000;
const retryBackoffFactor = 2;
const maximumRetryDelayMs = 5000;

/** Shared reference-style query settings; mutations never retry automatically. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, error) =>
          count < maximumQueryRetries && error instanceof ApiClientError && error.retryable,
        retryDelay: (attempt) =>
          Math.min(initialRetryDelayMs * retryBackoffFactor ** attempt, maximumRetryDelayMs),
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
