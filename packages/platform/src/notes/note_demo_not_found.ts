import { Data } from "effect";

interface NoteDemoNotFoundDetails {
  readonly id: string;
}

/** Typed note job failure preserves the affected identifier. */
export class NoteDemoNotFound extends Data.TaggedError(
  "NoteDemoNotFound",
)<NoteDemoNotFoundDetails> {}
