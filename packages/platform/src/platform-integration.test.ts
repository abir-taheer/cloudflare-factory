import { clearRedisTestNamespace } from "./testing/redis-fixtures.js";
import { readIntegrationConfiguration } from "./testing/integration-configuration.js";
/* oxlint-disable import/max-dependencies -- Integration test verifies multiple real capabilities together. */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";
import { Coordinator, Database, KeyValue, Queue } from "./capability-services.js";
import { postgresDatabaseLayer } from "./adapters/postgres-database.js";
import { createVerifiedTestUser, deleteTestUserAndClosePool } from "./testing/database-fixtures.js";
import {
  consumeRedisJobs,
  ensureRedisQueueGroup,
  reclaimRedisJobs,
  redisCoordinatorLayer,
  redisKeyValueLayer,
  redisQueueLayer,
} from "./adapters/redis-capabilities.js";

const integrationConfiguration = Effect.runSync(
  readIntegrationConfiguration(["PLATFORM_INTEGRATION", "DATABASE_URL", "REDIS_URL"]),
);

const enabled = integrationConfiguration["PLATFORM_INTEGRATION"] === "1";

test(
  "real Postgres note persistence and Redis stream recovery, cache expiration and ownership",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: integrationConfiguration["DATABASE_URL"] });

    const redis = createClient({
      RESP: 2,
      url: integrationConfiguration["REDIS_URL"] ?? "redis://redis:6379",
    });

    redis.on("error", () => {
      /* Command promises surface test failures. */
    });

    const prefix = `platform-test:${randomUUID()}:`;
    const noteId = randomUUID();
    const ownerUserId = randomUUID();

    try {
      await redis.connect();
      await Effect.runPromise(createVerifiedTestUser(pool, ownerUserId));

      const layer = Layer.mergeAll(
        postgresDatabaseLayer(pool),
        redisKeyValueLayer(redis, prefix),
        redisCoordinatorLayer(redis, prefix),
        redisQueueLayer(redis, `${prefix}stream`),
      );

      const run = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          | typeof Database.Identifier
          | typeof KeyValue.Identifier
          | typeof Coordinator.Identifier
          | typeof Queue.Identifier
        >,
      ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

      const note = {
        id: noteId,
        ownerUserId,
        text: "quotes ' and unicode ☃",
        createdAt: new Date().toISOString(),
      };

      await run(Database.use((db) => db.createNote(note)));

      const storedNote = await run(Database.use((db) => db.getNote(noteId, note.ownerUserId)));
      const missingNote = await run(Database.use((db) => db.getNote("missing", note.ownerUserId)));
      const otherOwnerNote = await run(Database.use((db) => db.getNote(noteId, randomUUID())));
      assert.deepEqual([storedNote, missingNote, otherOwnerNote], [note, null, null]);

      const duplicate = await run(Database.use((db) => db.createNote(note)).pipe(Effect.flip));

      assert.equal(duplicate._tag, "CapabilityError");
      await run(KeyValue.use((cache) => cache.put("cache", "value", 60)));

      const cachedValue = await run(KeyValue.use((cache) => cache.get("cache")));
      const cacheTtl = await redis.ttl(`${prefix}cache`);

      assert.equal(cachedValue, "value");
      assert.ok(cacheTtl > 0);

      const acquired = await run(
        Coordinator.use((lease) => lease.acquire("lease", "owner-a", 5000)),
      );

      const contended = await run(
        Coordinator.use((lease) => lease.acquire("lease", "owner-b", 5000)),
      );

      const wrongOwnerReleased = await run(
        Coordinator.use((lease) => lease.release("lease", "owner-b")),
      );

      const ownerReleased = await run(
        Coordinator.use((lease) => lease.release("lease", "owner-a")),
      );

      assert.deepEqual(
        { acquired, contended, wrongOwnerReleased, ownerReleased },
        { acquired: true, contended: false, wrongOwnerReleased: false, ownerReleased: true },
      );

      await Effect.runPromise(ensureRedisQueueGroup(redis, `${prefix}stream`, "workers"));

      await run(
        Queue.use((queue) => queue.enqueue({ id: "job", noteId, ownerUserId: note.ownerUserId })),
      );

      const failure = await Effect.runPromise(
        consumeRedisJobs(redis, `${prefix}stream`, "workers", "first", () =>
          Promise.reject(new Error("worker died")),
        ).pipe(Effect.flip),
      );

      assert.equal(failure._tag, "CapabilityError");

      const pendingBefore = await redis.xPending(`${prefix}stream`, "workers");

      assert.equal(pendingBefore.pending, 1);
      await delay(5);

      let processed = 0;

      await Effect.runPromise(
        reclaimRedisJobs(redis, `${prefix}stream`, "workers", "second", 1, "0-0", (job) => {
          assert.equal(job.noteId, noteId);
          processed += 1;
          return Promise.resolve();
        }),
      );

      assert.equal(processed, 1);

      const pendingAfter = await redis.xPending(`${prefix}stream`, "workers");
      assert.equal(pendingAfter.pending, 0);
    } finally {
      try {
        await Effect.runPromise(deleteTestUserAndClosePool(pool, ownerUserId));
      } finally {
        await Effect.runPromise(clearRedisTestNamespace(redis, prefix));
      }
    }
  },
);
