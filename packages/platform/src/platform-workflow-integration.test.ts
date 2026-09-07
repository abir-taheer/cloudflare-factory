import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ManagedRuntime } from "effect";
import { Client, Connection } from "@temporalio/client";
import { Pool } from "pg";
import { Database, ObjectStore, Workflow } from "./capability-services.js";
import { portablePlatformLayer } from "./adapters/portable.js";

const enabled = process.env['PLATFORM_WORKFLOW_INTEGRATION'] === '1';
test("real scoped portable layer starts a Temporal workflow once and closes its clients", { skip: !enabled, timeout: 60_000 }, async () => {
  const noteId = randomUUID();
  const jobId = randomUUID();
  const config = {
    databaseUrl: process.env['DATABASE_URL'] ?? '', redisUrl: process.env['REDIS_URL'] ?? '',
    s3Endpoint: process.env['S3_ENDPOINT'] ?? '', s3AccessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
    s3SecretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '', s3Bucket: process.env['S3_BUCKET'] ?? '',
    smtpHost: process.env['SMTP_HOST'] ?? '', smtpPort: Number(process.env['SMTP_PORT']),
    temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? '',
    temporalNamespace: process.env['TEMPORAL_NAMESPACE'] ?? '',
    workflowType: 'processNoteWorkflow', taskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? '', namespace: `platform-test:${jobId}`,
  };
  const runtime = ManagedRuntime.make(portablePlatformLayer(config));
  const connection = await Connection.connect({ address: config.temporalAddress });
  const client = new Client({ connection, namespace: config.temporalNamespace });
  try {
    await runtime.runPromise(Database.use(database => database.createNote({ id: noteId, text: 'Durable workflow', createdAt: new Date().toISOString() })));
    const job = { id: jobId, noteId };
    assert.equal(await runtime.runPromise(Workflow.use(workflow => workflow.start(job))), jobId);
    assert.equal(await runtime.runPromise(Workflow.use(workflow => workflow.start(job))), jobId);
    const handle = client.workflow.getHandle(jobId);
    await handle.result();
    const firstRun = await handle.describe();
    assert.equal(await runtime.runPromise(Workflow.use(workflow => workflow.start(job))), jobId);
    const afterReplay = await handle.describe();
    assert.equal(afterReplay.runId, firstRun.runId);
    const stored = await runtime.runPromise(ObjectStore.use(objects => objects.get(`job/${jobId}.json`)));
    assert.ok(stored !== null);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(stored)), { id: jobId, noteId, status: 'completed', content: 'DURABLE WORKFLOW' });
    await runtime.runPromise(ObjectStore.use(objects => objects.delete(`job/${jobId}.json`)));
  } finally {
    await runtime.dispose();
    await connection.close();
    const pool = new Pool({ connectionString: config.databaseUrl });
    try { await pool.query('DELETE FROM notes WHERE id=$1', [noteId]); }
    finally { await pool.end(); }
  }
});
