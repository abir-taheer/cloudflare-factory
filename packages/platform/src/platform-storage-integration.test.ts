/* oxlint-disable import/max-dependencies -- Integration verifies a database-to-object-store job and SMTP together. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createTransport } from "nodemailer";
import { createClient } from "redis";
import { Coordinator, KeyValue, ObjectStore, Email, Database } from "./capability-services.js";
import { redisCoordinatorLayer, redisKeyValueLayer } from "./adapters/redis-capabilities.js";
import { postgresDatabaseLayer } from "./adapters/postgres-database.js";
import { s3ObjectStoreLayer } from "./adapters/s3-object-store.js";
import { smtpEmailLayer } from "./adapters/email-adapters.js";
import { runNoteJob } from "./note-demo.js";

const enabled = process.env['PLATFORM_STORAGE_INTEGRATION'] === '1';
test("real S3 job output replays, missing objects, deletes, and SMTP acceptance", { skip: !enabled }, async () => {
  const noteId = randomUUID();
  const jobId = randomUUID();
  const redis = createClient({ RESP: 2, url: process.env['REDIS_URL'] ?? '' });
  redis.on('error', () => { /* Provider commands surface test failures. */ });
  const prefix = `platform-storage-test:${jobId}:`;
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const s3 = new S3Client({ endpoint: process.env['S3_ENDPOINT'] ?? '', region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '', secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '' } });
  const smtp = createTransport({ host: process.env['SMTP_HOST'] ?? '', port: Number(process.env['SMTP_PORT']), secure: false });
  const layer = Layer.mergeAll(postgresDatabaseLayer(pool), s3ObjectStoreLayer(s3, process.env['S3_BUCKET'] ?? ''), smtpEmailLayer(smtp), redisCoordinatorLayer(redis, `${prefix}leases:`), redisKeyValueLayer(redis, `${prefix}cache:`));
  const run = <A, E>(effect: Effect.Effect<A, E, typeof Database.Identifier | typeof ObjectStore.Identifier | typeof Email.Identifier | typeof Coordinator.Identifier | typeof KeyValue.Identifier>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  try {
    await redis.connect();
    await run(Database.use(database => database.createNote({ id: noteId, text: 'Hello cloud', createdAt: new Date().toISOString() })));
    const job = { id: jobId, noteId };
    await run(Coordinator.use(coordinator => coordinator.acquire(jobId, 'other-attempt', 60_000)));
    const contention = await run(runNoteJob(job).pipe(Effect.flip));
    assert.equal(contention._tag, 'NoteJobContended');
    assert.equal(await redis.get(`${prefix}leases:${jobId}`), 'other-attempt');
    await run(Coordinator.use(coordinator => coordinator.release(jobId, 'other-attempt')));
    await run(KeyValue.use(cache => cache.put(`note/${noteId}`, '{invalid cached note', 300)));
    const first = await run(runNoteJob(job));
    assert.equal(await redis.get(`${prefix}leases:${jobId}`), null);
    assert.ok(await redis.ttl(`${prefix}cache:note/${noteId}`) > 0);
    // Delete the immutable source after its cache fill to prove replay actually reads cached data.
    await pool.query('DELETE FROM notes WHERE id=$1', [noteId]);
    assert.deepEqual(await run(runNoteJob(job)), first);
    assert.deepEqual(first, { ...job, status: 'completed', content: 'HELLO CLOUD' });
    const stored = await run(ObjectStore.use(objects => objects.get(`job/${jobId}.json`)));
    assert.ok(stored !== null);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(stored)), first);
    await run(ObjectStore.use(objects => objects.delete(`job/${jobId}.json`)));
    assert.equal(await run(ObjectStore.use(objects => objects.get(`job/${jobId}.json`))), null);
    await run(Email.use(email => email.send({ from: 'platform-test@example.test', to: 'sink@example.test', subject: `Platform adapter ${jobId}`, text: 'Docker-only local SMTP integration test' })));
  } finally {
    await run(ObjectStore.use(objects => objects.delete(`job/${jobId}.json`)));
    await pool.query('DELETE FROM notes WHERE id=$1', [noteId]);
    await pool.end();
    s3.destroy();
    smtp.close();
    if (redis.isOpen) {
      await redis.del([`${prefix}leases:${jobId}`, `${prefix}cache:note/${noteId}`]);
      redis.destroy();
    }
  }
});
