import { QueryClient } from "@tanstack/react-query";
import { shouldRetryApiRequest } from "./api-client.js";

const initialRetryDelayMs = 1000;
const retryBackoffFactor = 2;
const maximumRetryDelayMs = 5000;

/** Shared reference-style query settings; mutations never retry automatically. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: shouldRetryApiRequest,
        retryDelay: (attempt) =>
          Math.min(initialRetryDelayMs * retryBackoffFactor ** attempt, maximumRetryDelayMs),
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
