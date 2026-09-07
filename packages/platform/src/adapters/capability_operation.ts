import { Effect } from "effect";
import { CapabilityError } from "../capability_services.js";

/** Convert synchronous throws and rejected provider promises to a typed error. */
export const capabilityOperation = <A>(
  capability: string,
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CapabilityError({ capability, operation, cause }),
  }).pipe(Effect.withSpan(`platform.${capability}.${operation}`));

/** Enforce the common Cloudflare KV and Redis expiration contract. */
const minimumCacheTtlSeconds = 60;

export function validateCacheTtl(ttl?: number): void {
  if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl < minimumCacheTtlSeconds)) {
    throw new Error("Cache TTL must be a whole number of seconds at least 60");
  }
}

/** Reject invalid lease durations before provider calls. */
export function validateLeaseInput(token: string, ttlMs: number): void {
  if (!token || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Coordinator lease requires a token and positive integer TTL");
  }
}
