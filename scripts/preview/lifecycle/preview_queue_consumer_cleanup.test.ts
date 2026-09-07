import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { Effect } from "effect";
import { previewResource } from "../preview_model.ts";
import { createPreviewCloudflare } from "../cloudflare/preview_cloudflare.ts";
import { previewDomainFixture } from "../domains/preview_domain_fixture.ts";
import { detachPreviewQueueConsumer } from "./preview_queue_consumer_cleanup.ts";

process.env["RESOURCE_PREFIX"] = "test";

function queueFixture(context: TestContext) {
  const fixture = previewDomainFixture(context);
  const queue = previewResource(fixture.manifest, "jobs");
  const worker = previewResource(fixture.manifest, "workflows");
  const queueId = "d".repeat(32);

  queue.id = queueId;

  const remote = {
    workerName: worker.name,
    consumers: [{ consumer_id: "e".repeat(32), type: "worker", script: worker.name }],
    interruptedDelete: false,
    retainConsumer: false,
  };

  const queuePath = `/client/v4/accounts/${fixture.credentials.accountId}/queues`;
  const consumerPath = `${queuePath}/${queueId}/consumers`;
  const workersPath = `/client/v4/accounts/${fixture.credentials.accountId}/workers/scripts`;

  context.mock.method(globalThis, "fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);

    if (url.pathname === queuePath) {
      return Promise.resolve(
        Response.json({
          success: true,
          result: [{ queue_id: queueId, queue_name: queue.name }],
        }),
      );
    }

    if (url.pathname === workersPath) {
      return Promise.resolve(Response.json({ success: true, result: [{ id: remote.workerName }] }));
    }

    if (url.pathname === consumerPath) {
      return Promise.resolve(Response.json({ success: true, result: remote.consumers }));
    }

    const consumer = remote.consumers[0];

    const isConsumerDeletion =
      consumer !== undefined &&
      url.pathname === `${consumerPath}/${consumer.consumer_id}` &&
      init?.method === "DELETE";

    if (isConsumerDeletion) {
      if (remote.retainConsumer) {
        return Promise.resolve(Response.json({ success: true }));
      }

      remote.consumers = [];

      if (remote.interruptedDelete) {
        remote.interruptedDelete = false;
        throw new Error("Simulated response loss after consumer deletion");
      }

      return Promise.resolve(Response.json({ success: true }));
    }

    throw new Error("Unexpected provider mutation");
  });

  const cf = createPreviewCloudflare(fixture.credentials);
  const detach = () => Effect.runPromise(detachPreviewQueueConsumer(fixture.manifest, cf));

  return { ...fixture, cf, queue, worker, remote, detach };
}

test("queue consumer deletion recovers a lost response while retaining its queue and Worker", async (context) => {
  const fixture = queueFixture(context);

  fixture.remote.interruptedDelete = true;
  await assert.rejects(fixture.detach());
  await fixture.detach();
  assert.equal(fixture.remote.consumers.length, 0);

  const queueId = await Effect.runPromise(fixture.cf.lookupResource(fixture.queue));
  const workerId = await Effect.runPromise(fixture.cf.lookupResource(fixture.worker));

  assert.equal(queueId, fixture.queue.id);
  assert.equal(workerId, fixture.worker.id);
});

test("foreign queue consumer is retained", async (context) => {
  const fixture = queueFixture(context);
  const consumer = fixture.remote.consumers[0];

  assert.ok(consumer);
  consumer.script = "unrelated-worker";
  await assert.rejects(fixture.detach());
  assert.deepEqual(fixture.remote.consumers, [consumer]);
});

test("HTTP pull consumer and replaced queue identity block detachment", async (context) => {
  const fixture = queueFixture(context);
  const consumer = fixture.remote.consumers[0];

  assert.ok(consumer);
  consumer.type = "http_pull";
  await assert.rejects(fixture.detach());
  consumer.type = "worker";
  fixture.queue.id = "f".repeat(32);
  await assert.rejects(fixture.detach());
  assert.deepEqual(fixture.remote.consumers, [consumer]);
});

test("missing queue identity is rejected even when no consumer remains", async (context) => {
  const fixture = queueFixture(context);

  fixture.queue.id = null;
  fixture.remote.consumers = [];
  await assert.rejects(fixture.detach());

  const queueId = await Effect.runPromise(fixture.cf.lookupResource(fixture.queue));

  assert.equal(queueId, "d".repeat(32));
});

test("replaced Worker and duplicate consumers are retained", async (context) => {
  const fixture = queueFixture(context);
  const consumer = fixture.remote.consumers[0];

  assert.ok(consumer);
  fixture.worker.id = "changed-worker";
  await assert.rejects(fixture.detach());
  fixture.worker.id = fixture.worker.name;
  fixture.remote.consumers.push({ ...consumer });
  await assert.rejects(fixture.detach());
  assert.equal(fixture.remote.consumers.length, 2);
});

test("conflicting provider script aliases never authorize detachment", async (context) => {
  const fixture = queueFixture(context);
  const consumer = fixture.remote.consumers[0];

  assert.ok(consumer);
  Object.assign(consumer, { script_name: "foreign-worker" });
  await assert.rejects(fixture.detach());
  assert.deepEqual(fixture.remote.consumers, [consumer]);
});

test("successful DELETE with a remaining consumer blocks cleanup until retry", async (context) => {
  const fixture = queueFixture(context);

  fixture.remote.retainConsumer = true;
  await assert.rejects(fixture.detach());
  assert.equal(fixture.remote.consumers.length, 1);

  const queueId = await Effect.runPromise(fixture.cf.lookupResource(fixture.queue));
  const workerId = await Effect.runPromise(fixture.cf.lookupResource(fixture.worker));

  assert.equal(queueId, fixture.queue.id);
  assert.equal(workerId, fixture.worker.id);
  fixture.remote.retainConsumer = false;
  await fixture.detach();
  assert.equal(fixture.remote.consumers.length, 0);
});
