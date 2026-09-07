/* oxlint-disable import/max-dependencies -- Integration test verifies multiple real capabilities together. */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";
import { Database, KeyValue, Coordinator, Queue } from "./capability-services.js";
import { postgresDatabaseLayer } from "./adapters/postgres-database.js";
import { redisKeyValueLayer, redisCoordinatorLayer, redisQueueLayer, ensureRedisQueueGroup, consumeRedisJobs, reclaimRedisJobs } from "./adapters/redis-capabilities.js";

const enabled = process.env['PLATFORM_INTEGRATION'] === '1';
test("real Postgres note persistence and Redis stream recovery, cache expiration and ownership", { skip: !enabled }, async () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const redis = createClient({ RESP: 2, url: process.env['REDIS_URL'] ?? "redis://redis:6379" });
  redis.on("error", () => { /* Command promises surface test failures. */ });
  const prefix = `platform-test:${randomUUID()}:`;
  const noteId = randomUUID();
  try {
    await redis.connect();
    await pool.query(await readFile(new URL("../migrations/001-notes.sql", import.meta.url), "utf8"));
    const layer = Layer.mergeAll(postgresDatabaseLayer(pool), redisKeyValueLayer(redis, prefix), redisCoordinatorLayer(redis, prefix), redisQueueLayer(redis, `${prefix}stream`));
    const run = <A, E>(effect: Effect.Effect<A, E, typeof Database.Identifier | typeof KeyValue.Identifier | typeof Coordinator.Identifier | typeof Queue.Identifier>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
    const note = { id: noteId, text: "quotes ' and unicode ☃", createdAt: new Date().toISOString() };
    await run(Database.use((db) => db.createNote(note)));
    assert.deepEqual(await run(Database.use((db) => db.getNote(noteId))), note);
    assert.equal(await run(Database.use((db) => db.getNote("missing"))), null);
    const duplicate = await run(Database.use((db) => db.createNote(note)).pipe(Effect.flip));
    assert.equal(duplicate._tag, "CapabilityError");
    await run(KeyValue.use((cache) => cache.put("cache", "value", 60)));
    assert.equal(await run(KeyValue.use((cache) => cache.get("cache"))), "value");
    assert.ok((await redis.ttl(`${prefix}cache`)) > 0);
    assert.equal(await run(Coordinator.use((lease) => lease.acquire("lease", "owner-a", 5000))), true);
    assert.equal(await run(Coordinator.use((lease) => lease.acquire("lease", "owner-b", 5000))), false);
    assert.equal(await run(Coordinator.use((lease) => lease.release("lease", "owner-b"))), false);
    assert.equal(await run(Coordinator.use((lease) => lease.release("lease", "owner-a"))), true);
    await Effect.runPromise(ensureRedisQueueGroup(redis, `${prefix}stream`, "workers"));
    await run(Queue.use((queue) => queue.enqueue({ id: "job", noteId })));
    const failure = await Effect.runPromise(consumeRedisJobs(redis, `${prefix}stream`, "workers", "first", () => Promise.reject(new Error("worker died"))).pipe(Effect.flip));
    assert.equal(failure._tag, "CapabilityError");
    const pendingBefore = await redis.xPending(`${prefix}stream`, "workers");
    assert.equal(pendingBefore.pending, 1);
    await delay(5);
    let processed = 0;
    await Effect.runPromise(reclaimRedisJobs(redis, `${prefix}stream`, "workers", "second", 1, "0-0", (job) => { assert.equal(job.noteId, noteId); processed += 1; return Promise.resolve(); }));
    assert.equal(processed, 1);
    const pendingAfter = await redis.xPending(`${prefix}stream`, "workers");
    assert.equal(pendingAfter.pending, 0);
  } finally {
    await pool.query("DELETE FROM notes WHERE id=$1", [noteId]);
    await pool.end();
    if (redis.isOpen) { const keys = await redis.keys(`${prefix}*`); if (keys.length > 0) await redis.del(keys); redis.destroy(); }
  }
});
