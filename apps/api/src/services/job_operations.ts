import { Effect } from "effect";
import { CapabilityError, Database, ObjectStore, Queue } from "@factory/platform";
import type { z } from "@hono/zod-openapi";
import type { CompletedJobSchema } from "@factory/api-contract/schema";
import { NoteJobResultSchema } from "@factory/platform/demo";
import { ApiNotFoundError } from "../http/api_errors.js";

/** Job creation checks note existence before accepting work into the queue. */
export const createApiJob = Effect.fn("api.jobs.create")(function* (
  noteId: string,
  ownerUserId: string,
) {
  const database = yield* Database;
  const note = yield* database.getNote(noteId, ownerUserId);

  if (note === null) {
    return yield* Effect.fail(new ApiNotFoundError({ message: "Note not found" }));
  }

  const job = { id: crypto.randomUUID(), noteId, ownerUserId };
  const queue = yield* Queue;

  yield* queue.enqueue(job);
  return { id: job.id, noteId: job.noteId };
});

/** Job lookup checks persisted ownership before returning any completed result data. */
export const getApiJob = Effect.fn("api.jobs.get")(function* (id: string, ownerUserId: string) {
  const objects = yield* ObjectStore;
  const bytes = yield* objects.get(`job/${id}.json`);

  if (bytes === null) {
    return null;
  }

  const result = yield* Effect.try({
    try: () => NoteJobResultSchema.parse(JSON.parse(new TextDecoder().decode(bytes))),
    catch: () =>
      new CapabilityError({
        capability: "ObjectStore",
        operation: "decodeJob",
        cause: "Invalid stored job",
      }),
  });

  if (result.ownerUserId !== ownerUserId || result.id !== id) {
    return yield* Effect.fail(new ApiNotFoundError({ message: "Not found" }));
  }

  const publicResult: z.infer<typeof CompletedJobSchema> = {
    id: result.id,
    noteId: result.noteId,
    status: result.status,
    content: result.content,
  };

  return publicResult;
});
