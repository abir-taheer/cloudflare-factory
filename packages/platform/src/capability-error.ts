import { Data } from "effect";

interface CapabilityErrorDetails {
  readonly capability: string;
  readonly operation: string;
  readonly cause: unknown;
}

/** Provider failure preserves diagnostics without claiming success. */
export class CapabilityError extends Data.TaggedError("CapabilityError")<CapabilityErrorDetails> {}
