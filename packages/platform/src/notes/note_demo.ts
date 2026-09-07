import { z } from "zod";
import { makePlatformDecoder } from "../parse_platform_value.js";
import { NoteJobLeaseLost } from "./note_job_lease_lost.js";
import { NoteJobContended } from "./note_job_contended.js";
import { NoteDemoNotFound } from "./note_demo_not_found.js";
import { Effect } from "effect";
import {
  type BackgroundJob,
  BackgroundJobSchema,
  Coordinator,
  Database,
  KeyValue,
  type NoteRecord,
  NoteRecordSchema,
  ObjectStore,
} from "../capability_services.js";

/** Missing note is a domain failure rather than a provider outage. */
export { NoteDemoNotFound } from "./note_demo_not_found.js";
/** Another attempt owns this job's lease; queue or workflow hosts should retry. */
export { NoteJobContended } from "./note_job_contended.js";
/** The lease expired before release; the deterministic artifact remains safe to replay. */
export { NoteJobLeaseLost } from "./note_job_lease_lost.js";

/** Completed job output persisted by both Cloudflare and Temporal workflow hosts. */
export const NoteJobResultSchema = BackgroundJobSchema.extend({
  status: z.literal("completed"),
  content: z.string(),
});

export type NoteJobResult = z.infer<typeof NoteJobResultSchema>;
const noteJobLeaseTtlMs = 60_000;
const noteCacheTtlSeconds = 300;

const decodeCachedNote = makePlatformDecoder(NoteRecordSchema);

function readCachedNote(raw: string | null, id: string, ownerUserId: string): NoteRecord | null {
  if (raw === null) {
    return null;
  }

  try {
    const note = decodeCachedNote(JSON.parse(raw));
    return note.id === id && note.ownerUserId === ownerUserId ? note : null;
  } catch {
    return null;
  }
}

/** Job lease lasts 60 seconds; validated immutable notes are cached for 300 seconds, and replay overwrites job/{id}.json. */
export const runNoteJob = Effect.fn("platform.noteJob.run")(function* (job: BackgroundJob) {
  const coordinator = yield* Coordinator;
  const database = yield* Database;
  const cache = yield* KeyValue;
  const objects = yield* ObjectStore;

  return yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const token = yield* Effect.sync(() => crypto.randomUUID());
      const acquired = yield* coordinator.acquire(job.id, token, noteJobLeaseTtlMs);

      if (!acquired) {
        return yield* Effect.fail(new NoteJobContended({ id: job.id }));
      }

      return token;
    }),
    () =>
      Effect.gen(function* () {
        const cacheKey = `note/${encodeURIComponent(job.ownerUserId)}/${job.noteId}`;
        let note = readCachedNote(yield* cache.get(cacheKey), job.noteId, job.ownerUserId);

        if (note === null) {
          note = yield* database.getNote(job.noteId, job.ownerUserId);

          if (note === null) {
            return yield* Effect.fail(new NoteDemoNotFound({ id: job.noteId }));
          }

          yield* cache.put(cacheKey, JSON.stringify(note), noteCacheTtlSeconds);
        }

        const result: NoteJobResult = {
          id: job.id,
          noteId: job.noteId,
          ownerUserId: job.ownerUserId,
          status: "completed",
          content: note.text.toUpperCase(),
        };

        yield* objects.put(`job/${job.id}.json`, new TextEncoder().encode(JSON.stringify(result)));
        return result;
      }),
    (token) =>
      Effect.gen(function* () {
        const released = yield* coordinator.release(job.id, token);

        if (!released) {
          return yield* Effect.fail(new NoteJobLeaseLost({ id: job.id }));
        }

        return yield* Effect.void;
      }),
  );
});
