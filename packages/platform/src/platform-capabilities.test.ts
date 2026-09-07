import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { Effect, Layer } from "effect";
import { Coordinator, Database, KeyValue, ObjectStore, Sandbox, CapabilityError } from "./capability-services.js";
import { runNoteJob } from "./note-demo.js";
import { httpSandboxLayer, unavailableSandboxLayer } from "./adapters/sandbox-adapters.js";
import { capabilityOperation } from "./adapters/capability-operation.js";

test("provider rejection and synchronous throw retain typed errors", async () => {
  await Promise.all([() => Promise.reject(new Error("offline")), () => { throw new Error("offline"); }].map(async (run) => {
    const failure = await Effect.runPromise(capabilityOperation("database", "read", run).pipe(Effect.flip));
    assert.equal(failure._tag, "CapabilityError");
    assert.equal(failure.operation, "read");
  }));
});
test("optional sandbox is explicitly unavailable", async () => {
  const failure = await Effect.runPromise(Sandbox.use((sandbox) => sandbox.execute({ command: "echo x", timeoutMs: 1000 })).pipe(Effect.provide(unavailableSandboxLayer), Effect.flip));
  assert.equal(failure._tag, "CapabilityUnavailable");
});
test("HTTP sandbox rejects non-2xx and malformed executor responses", async () => {
  let status = 503;
  const server = createServer((_request, response) => { response.writeHead(status, { "content-type": "application/json" }); response.end('{}'); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const layer = httpSandboxLayer(`http://127.0.0.1:${address.port}`, "test-token");
    for (status of [503, 200]) {
      // oxlint-disable-next-line no-await-in-loop -- The same server changes its response between requests.
      const failure = await Effect.runPromise(Sandbox.use((sandbox) => sandbox.execute({ command: "echo x", timeoutMs: 1000 })).pipe(Effect.provide(layer), Effect.flip));
      assert.equal(failure._tag, "CapabilityError");
    }
  } finally { server.close(); await once(server, "close"); }
});
test("note job does not report completion when object storage fails", async () => {
  let released = false;
  const failure = new CapabilityError({ capability: "objectStore", operation: "put", cause: "offline" });
  const layer = Layer.mergeAll(
    Layer.succeed(Coordinator, Coordinator.of({ acquire: () => Effect.succeed(true), release: () => Effect.sync(() => { released = true; return true; }) })),
    Layer.succeed(KeyValue, KeyValue.of({ get: () => Effect.succeed(null), put: () => Effect.void, delete: () => Effect.void })),
    Layer.succeed(Database, Database.of({ createNote: () => Effect.void, getNote: () => Effect.succeed({ id: "note", text: "Hello", createdAt: "2026-09-07T00:00:00Z" }) })),
    Layer.succeed(ObjectStore, ObjectStore.of({ put: () => Effect.fail(failure), get: () => Effect.succeed(null), delete: () => Effect.void })),
  );
  assert.equal(await Effect.runPromise(runNoteJob({ id: "job", noteId: "note" }).pipe(Effect.provide(layer), Effect.flip)), failure);
  assert.equal(released, true);
});
