import { Data } from "effect";

interface NoteJobLeaseLostDetails {
  readonly id: string;
}

/** Typed note job failure preserves the affected identifier. */
export class NoteJobLeaseLost extends Data.TaggedError(
  "NoteJobLeaseLost",
)<NoteJobLeaseLostDetails> {}
