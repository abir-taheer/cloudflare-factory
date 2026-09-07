import { Data } from "effect";

interface NoteJobContendedDetails {
  readonly id: string;
}

/** Typed note job failure preserves the affected identifier. */
export class NoteJobContended extends Data.TaggedError(
  "NoteJobContended",
)<NoteJobContendedDetails> {}
