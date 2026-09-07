import { Effect } from "effect";
import { Database } from "@factory/platform";
import { ApiNotFoundError } from "../http/api-errors.js";

/** Note creation preserves whitespace and generates identity only when the effect runs. */
export const createApiNote = Effect.fn("api.notes.create")(function* (
  content: string,
  ownerUserId: string,
) {
  const database = yield* Database;

  const note = {
    id: crypto.randomUUID(),
    ownerUserId,
    text: content,
    createdAt: new Date().toISOString(),
  };

  yield* database.createNote(note);
  return { id: note.id, text: note.text, content: note.text, createdAt: note.createdAt };
});

/** Note lookup retains stored text alongside the frontend content alias. */
export const getApiNote = Effect.fn("api.notes.get")(function* (id: string, ownerUserId: string) {
  const database = yield* Database;
  const note = yield* database.getNote(id, ownerUserId);

  if (note === null) {
    return yield* Effect.fail(new ApiNotFoundError({ message: "Not found" }));
  }

  return { id: note.id, text: note.text, content: note.text, createdAt: note.createdAt };
});
