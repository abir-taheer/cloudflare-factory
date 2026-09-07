import { Data } from "effect";

interface CapabilityUnavailableDetails {
  readonly capability: string;
}

/** Missing optional capability fails explicitly at use time. */
export class CapabilityUnavailable extends Data.TaggedError(
  "CapabilityUnavailable",
)<CapabilityUnavailableDetails> {}
