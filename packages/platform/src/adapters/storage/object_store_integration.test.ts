import { clearRedisTestNamespace } from "../../testing/redis_fixtures.js";
import { readIntegrationConfiguration } from "../../testing/integration_configuration.js";
/* oxlint-disable import/max-dependencies -- Integration verifies a database-to-object-store job and SMTP together. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createTransport } from "nodemailer";
import { createClient } from "redis";
import { Coordinator, Database, Email, KeyValue, ObjectStore } from "../../capability_services.js";
import { redisCoordinatorLayer, redisKeyValueLayer } from "../coordination/redis_capabilities.js";
import { postgresDatabaseLayer } from "../database/postgres_database.js";
import { s3ObjectStoreLayer } from "./s3_object_store.js";
import { smtpEmailLayer } from "../email/email_adapters.js";
import { runNoteJob } from "../../notes/note_demo.js";
import {
  createVerifiedTestUser,
  deleteTestUserAndClosePool,
} from "../../testing/database_fixtures.js";

const integrationConfiguration = Effect.runSync(
  readIntegrationConfiguration([
    "PLATFORM_STORAGE_INTEGRATION",
    "REDIS_URL",
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "SMTP_HOST",
    "SMTP_PORT",
  ]),
);

const enabled = integrationConfiguration["PLATFORM_STORAGE_INTEGRATION"] === "1";

function createStorageTestClients() {
  const s3 = new S3Client({
    endpoint: integrationConfiguration["S3_ENDPOINT"] ?? "",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: integrationConfiguration["S3_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: integrationConfiguration["S3_SECRET_ACCESS_KEY"] ?? "",
    },
  });

  const smtp = createTransport({
    host: integrationConfiguration["SMTP_HOST"] ?? "",
    port: Number(integrationConfiguration["SMTP_PORT"]),
    secure: false,
  });

  return { s3, smtp };
}

test(
  "real S3 job output replays, missing objects, deletes, and SMTP acceptance",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const noteId = randomUUID();
    const jobId = randomUUID();
    const ownerUserId = randomUUID();
    const redis = createClient({ RESP: 2, url: integrationConfiguration["REDIS_URL"] ?? "" });

    redis.on("error", () => {
      /* Provider commands surface test failures. */
    });

    const prefix = `platform-storage-test:${jobId}:`;
    const pool = new Pool({ connectionString: integrationConfiguration["DATABASE_URL"] });
    const { s3, smtp } = createStorageTestClients();

    const layer = Layer.mergeAll(
      postgresDatabaseLayer(pool),
      s3ObjectStoreLayer(s3, integrationConfiguration["S3_BUCKET"] ?? ""),
      smtpEmailLayer(smtp),
      redisCoordinatorLayer(redis, `${prefix}leases:`),
      redisKeyValueLayer(redis, `${prefix}cache:`),
    );

    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | typeof Database.Identifier
        | typeof ObjectStore.Identifier
        | typeof Email.Identifier
        | typeof Coordinator.Identifier
        | typeof KeyValue.Identifier
      >,
    ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

    try {
      await redis.connect();
      await Effect.runPromise(createVerifiedTestUser(pool, ownerUserId));

      await run(
        Database.use((database) =>
          database.createNote({
            id: noteId,
            ownerUserId,
            text: "Hello cloud",
            createdAt: new Date().toISOString(),
          }),
        ),
      );

      const job = { id: jobId, noteId, ownerUserId };

      await run(
        Coordinator.use((coordinator) => coordinator.acquire(jobId, "other-attempt", 60_000)),
      );

      const contention = await run(runNoteJob(job).pipe(Effect.flip));
      assert.equal(contention._tag, "NoteJobContended");

      const contendedOwner = await redis.get(`${prefix}leases:${jobId}`);

      assert.equal(contendedOwner, "other-attempt");
      await run(Coordinator.use((coordinator) => coordinator.release(jobId, "other-attempt")));

      await run(
        KeyValue.use((cache) =>
          cache.put(`note/${ownerUserId}/${noteId}`, "{invalid cached note", 300),
        ),
      );

      const first = await run(runNoteJob(job));
      const releasedOwner = await redis.get(`${prefix}leases:${jobId}`);
      const cacheTtl = await redis.ttl(`${prefix}cache:note/${ownerUserId}/${noteId}`);

      assert.equal(releasedOwner, null);
      assert.ok(cacheTtl > 0);
      // Delete the immutable source after its cache fill to prove replay actually reads cached data.
      await pool.query("DELETE FROM notes WHERE id=$1", [noteId]);

      const replay = await run(runNoteJob(job));

      assert.deepEqual(replay, first);
      assert.deepEqual(first, { ...job, status: "completed", content: "HELLO CLOUD" });

      const stored = await run(ObjectStore.use((objects) => objects.get(`job/${jobId}.json`)));

      assert.ok(stored !== null);
      assert.deepEqual(JSON.parse(new TextDecoder().decode(stored)), first);
      await run(ObjectStore.use((objects) => objects.delete(`job/${jobId}.json`)));

      const deletedObject = await run(
        ObjectStore.use((objects) => objects.get(`job/${jobId}.json`)),
      );

      assert.equal(deletedObject, null);

      await run(
        Email.use((email) =>
          email.send({
            from: "platform-test@example.test",
            to: "sink@example.test",
            subject: `Platform adapter ${jobId}`,
            text: "Docker-only local SMTP integration test",
          }),
        ),
      );
    } finally {
      try {
        await run(ObjectStore.use((objects) => objects.delete(`job/${jobId}.json`)));
      } finally {
        s3.destroy();
        smtp.close();

        try {
          await Effect.runPromise(deleteTestUserAndClosePool(pool, ownerUserId));
        } finally {
          await Effect.runPromise(clearRedisTestNamespace(redis, prefix));
        }
      }
    }
  },
);
