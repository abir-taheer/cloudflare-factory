import { Data, Effect, Schema } from "effect";
import { Coordinator, Database, KeyValue, ObjectStore, type BackgroundJob, type NoteRecord } from "./capability-services.js";

/** Missing note is a domain failure rather than a provider outage. */
export class NoteDemoNotFound extends Data.TaggedError("NoteDemoNotFound")<{ readonly id: string }> {}
/** Another attempt owns this job's lease; queue or workflow hosts should retry. */
export class NoteJobContended extends Data.TaggedError("NoteJobContended")<{ readonly id: string }> {}
/** The lease expired before release; the deterministic artifact remains safe to replay. */
export class NoteJobLeaseLost extends Data.TaggedError("NoteJobLeaseLost")<{ readonly id: string }> {}
/** Completed job output persisted by both Cloudflare and Temporal workflow hosts. */
export interface NoteJobResult { readonly id: string; readonly noteId: string; readonly status: "completed"; readonly content: string }
const decodeCachedNote = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, text: Schema.String, createdAt: Schema.String }));

function readCachedNote(raw: string | null, id: string): NoteRecord | null {
  if (raw === null) return null;
  try {
    const note = decodeCachedNote(JSON.parse(raw));
    return note.id === id ? note : null;
  } catch { return null; }
}

/** Job lease lasts 60 seconds; validated immutable notes are cached for 300 seconds, and replay overwrites job/{id}.json. */
export const runNoteJob = (job: BackgroundJob) => Effect.gen(function* () {
  const coordinator = yield* Coordinator;
  const database = yield* Database;
  const cache = yield* KeyValue;
  const objects = yield* ObjectStore;
  return yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const token = yield* Effect.sync(() => crypto.randomUUID());
      const acquired = yield* coordinator.acquire(job.id, token, 60_000);
      if (!acquired) return yield* Effect.fail(new NoteJobContended({ id: job.id }));
      return token;
    }),
    () => Effect.gen(function* () {
      const cacheKey = `note/${job.noteId}`;
      let note = readCachedNote(yield* cache.get(cacheKey), job.noteId);
      if (note === null) {
        note = yield* database.getNote(job.noteId);
        if (note === null) return yield* Effect.fail(new NoteDemoNotFound({ id: job.noteId }));
        yield* cache.put(cacheKey, JSON.stringify(note), 300);
      }
      const result: NoteJobResult = { id: job.id, noteId: job.noteId, status: "completed", content: note.text.toUpperCase() };
      yield* objects.put(`job/${job.id}.json`, new TextEncoder().encode(JSON.stringify(result)));
      return result;
    }),
    (token) => Effect.gen(function* () {
      const released = yield* coordinator.release(job.id, token);
      if (!released) return yield* Effect.fail(new NoteJobLeaseLost({ id: job.id }));
      return yield* Effect.void;
    }),
  );
});
