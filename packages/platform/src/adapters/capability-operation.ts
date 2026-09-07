import { Effect } from "effect";
import { CapabilityError } from "../capability-services.js";

/** Convert synchronous throws and rejected provider promises to a typed error. */
export const capabilityOperation = <A>(capability: string, operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new CapabilityError({ capability, operation, cause }) });
/** Enforce the common Cloudflare KV and Redis expiration contract. */
export function validateCacheTtl(ttl?: number): void {
  if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl < 60)) throw new Error("Cache TTL must be a whole number of seconds at least 60");
}
/** Reject invalid lease durations before provider calls. */
export function validateLeaseInput(token: string, ttlMs: number): void {
  if (!token || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Coordinator lease requires a token and positive integer TTL");
}
