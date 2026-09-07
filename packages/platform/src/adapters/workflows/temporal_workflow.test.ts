import { readIntegrationConfiguration } from "../../testing/integration_configuration.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect, ManagedRuntime } from "effect";
import { Client, Connection } from "@temporalio/client";
import { Pool } from "pg";
import { Database, ObjectStore, Workflow } from "../../capability_services.js";
import { portablePlatformLayer } from "../portable.js";
import { createVerifiedTestUser, deleteTestUser } from "../../testing/database_fixtures.js";

const integrationConfiguration = Effect.runSync(
  readIntegrationConfiguration([
    "PLATFORM_WORKFLOW_INTEGRATION",
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "REDIS_URL",
    "SMTP_HOST",
    "SMTP_PORT",
    "TEMPORAL_ADDRESS",
    "TEMPORAL_NAMESPACE",
    "TEMPORAL_TASK_QUEUE",
  ]),
);

const enabled = integrationConfiguration["PLATFORM_WORKFLOW_INTEGRATION"] === "1";

test(
  "real scoped portable layer starts a Temporal workflow once and closes its clients",
  { skip: !enabled, timeout: 60_000 },
  async () => {
    const noteId = randomUUID();
    const jobId = randomUUID();
    const ownerUserId = randomUUID();

    const config = {
      databaseUrl: integrationConfiguration["DATABASE_URL"] ?? "",
      redisUrl: integrationConfiguration["REDIS_URL"] ?? "",
      s3Endpoint: integrationConfiguration["S3_ENDPOINT"] ?? "",
      s3AccessKeyId: integrationConfiguration["S3_ACCESS_KEY_ID"] ?? "",
      s3SecretAccessKey: integrationConfiguration["S3_SECRET_ACCESS_KEY"] ?? "",
      s3Bucket: integrationConfiguration["S3_BUCKET"] ?? "",
      smtpHost: integrationConfiguration["SMTP_HOST"] ?? "",
      smtpPort: Number(integrationConfiguration["SMTP_PORT"]),
      temporalAddress: integrationConfiguration["TEMPORAL_ADDRESS"] ?? "",
      temporalNamespace: integrationConfiguration["TEMPORAL_NAMESPACE"] ?? "",
      workflowType: "processNoteWorkflow",
      taskQueue: integrationConfiguration["TEMPORAL_TASK_QUEUE"] ?? "",
      namespace: `platform-test:${jobId}`,
    };

    const runtime = ManagedRuntime.make(portablePlatformLayer(config));
    const connection = await Connection.connect({ address: config.temporalAddress });
    const client = new Client({ connection, namespace: config.temporalNamespace });
    const pool = new Pool({ connectionString: config.databaseUrl });

    try {
      await Effect.runPromise(createVerifiedTestUser(pool, ownerUserId));

      await runtime.runPromise(
        Database.use((database) =>
          database.createNote({
            id: noteId,
            ownerUserId,
            text: "Durable workflow",
            createdAt: new Date().toISOString(),
          }),
        ),
      );

      const job = { id: jobId, noteId, ownerUserId };
      const started = await runtime.runPromise(Workflow.use((workflow) => workflow.start(job)));

      const duplicateStart = await runtime.runPromise(
        Workflow.use((workflow) => workflow.start(job)),
      );

      assert.equal(started, jobId);
      assert.equal(duplicateStart, jobId);

      const handle = client.workflow.getHandle(jobId);
      await handle.result();

      const firstRun = await handle.describe();

      const completedReplay = await runtime.runPromise(
        Workflow.use((workflow) => workflow.start(job)),
      );

      assert.equal(completedReplay, jobId);

      const afterReplay = await handle.describe();
      assert.equal(afterReplay.runId, firstRun.runId);

      const stored = await runtime.runPromise(
        ObjectStore.use((objects) => objects.get(`job/${jobId}.json`)),
      );

      assert.ok(stored !== null);

      assert.deepEqual(JSON.parse(new TextDecoder().decode(stored)), {
        id: jobId,
        noteId,
        ownerUserId,
        status: "completed",
        content: "DURABLE WORKFLOW",
      });

      await runtime.runPromise(ObjectStore.use((objects) => objects.delete(`job/${jobId}.json`)));
    } finally {
      await runtime.dispose();
      await connection.close();

      try {
        await Effect.runPromise(deleteTestUser(pool, ownerUserId));
      } finally {
        await pool.end();
      }
    }
  },
);
