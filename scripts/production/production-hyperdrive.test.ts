import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { Effect } from "effect";
import { previewRecord } from "../preview/preview-model.ts";
import { prepareProductionHyperdrive } from "./production-hyperdrive.ts";
import type { ProductionState } from "./production-state.ts";

function hyperdriveFixture(context: TestContext) {
  const configurations: Record<string, unknown>[] = [];

  const remote = {
    configurations,
    failReadback: false,
    foreignOnNextPage: false,
  };

  context.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const request = new Request(input, options);
      const url = new URL(request.url);

      if (request.method === "POST") {
        const body: unknown = await request.json();
        const configuration = previewRecord(body);
        const created = { ...configuration, id: "a".repeat(32) };

        remote.configurations.push(created);
        return Response.json({ success: true, result: created });
      }

      if (url.pathname.endsWith("/configs")) {
        const page = url.searchParams.get("page");
        const rows: Record<string, unknown>[] = [];

        if (remote.foreignOnNextPage && page === "1") {
          rows.push({ name: "unrelated-hyperdrive" });
        }

        if (remote.foreignOnNextPage && page === "2") {
          rows.push({ name: "test-prod-hyperdrive" });
        }

        return Response.json({ success: true, result: rows });
      }

      if (remote.failReadback) {
        return new Response(null, { status: 503 });
      }

      return Response.json({ success: true, result: remote.configurations[0] });
    },
  );

  const state: Pick<ProductionState, "hyperdriveId"> = { hyperdriveId: null };

  const run = () =>
    Effect.runPromise(
      prepareProductionHyperdrive({
        credentials: { accountId: "b".repeat(32), token: "synthetic-token" },
        prefix: "test-prod",
        database: {
          directUrl: "postgresql://test:synthetic@database.example.test/test?sslmode=require",
        },
        expectedId: state.hyperdriveId,
        allowCreate: true,
        save: (id) =>
          Effect.sync(() => {
            state.hyperdriveId = id;
          }),
      }),
    );

  return { remote, state, run };
}

test("production Hyperdrive readback failure retains the created ID and retries without allocating again", async (context) => {
  const fixture = hyperdriveFixture(context);
  fixture.remote.failReadback = true;

  await assert.rejects(fixture.run());
  assert.notEqual(fixture.state.hyperdriveId, null);
  assert.equal(fixture.remote.configurations.length, 1);

  fixture.remote.failReadback = false;

  const recovered = await fixture.run();

  assert.equal(recovered, fixture.state.hyperdriveId);
  assert.equal(fixture.remote.configurations.length, 1);
});

test("production Hyperdrive refuses a foreign name on a later short inventory page", async (context) => {
  const fixture = hyperdriveFixture(context);
  fixture.remote.foreignOnNextPage = true;

  await assert.rejects(fixture.run());
  assert.equal(fixture.state.hyperdriveId, null);
  assert.equal(fixture.remote.configurations.length, 0);
});

test("production Hyperdrive rejects retained origin and connection policy substitutions", async (context) => {
  const fixture = hyperdriveFixture(context);
  await fixture.run();

  const created = fixture.remote.configurations[0];
  assert.ok(created);

  for (const changed of [
    { origin: { ...previewRecord(created["origin"]), host: "foreign.example.test" } },
    { mtls: { sslmode: "disable" } },
    { caching: { disabled: false } },
  ]) {
    fixture.remote.configurations[0] = { ...created, ...changed };

    await assert.rejects(fixture.run());
    assert.equal(fixture.remote.configurations.length, 1);
  }
});
