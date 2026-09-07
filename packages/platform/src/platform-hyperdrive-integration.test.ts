import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Pool } from "pg";
import { Database } from "./capability-services.js";
import { hyperdriveDatabaseLayer } from "./adapters/hyperdrive-database.js";

const enabled = process.env['PLATFORM_INTEGRATION'] === '1';
test("Hyperdrive adapter uses a distinct scoped pg Client and closes it on success and failure", { skip: !enabled }, async () => {
  const connectionString = process.env['DATABASE_URL'] ?? '';
  const observer = new Pool({ connectionString });
  const marker = `hyperdrive-test-${randomUUID()}`;
  const url = new URL(connectionString);
  url.searchParams.set('application_name', marker);
  const layer = hyperdriveDatabaseLayer({ connectionString: url.toString() });
  const note = { id: randomUUID(), text: 'Scoped client', createdAt: new Date().toISOString() };
  const connections = async () => {
    const result = await observer.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE application_name=$1', [marker]);
    return result.rows;
  };
  try {
    const firstPid = await Effect.runPromise(Effect.gen(function* () {
      const database = yield* Database;
      yield* database.createNote(note);
      const active = yield* Effect.promise(connections);
      assert.equal(active.length, 1);
      return active[0]?.pid;
    }).pipe(Effect.provide(layer)));
    const afterSuccess = await connections();
    assert.equal(afterSuccess.length, 0);
    const secondPid = await Effect.runPromise(Effect.gen(function* () {
      const database = yield* Database;
      assert.deepEqual(yield* database.getNote(note.id), note);
      const active = yield* Effect.promise(connections);
      assert.equal(active.length, 1);
      return active[0]?.pid;
    }).pipe(Effect.provide(layer)));
    assert.notEqual(firstPid, secondPid);
    const duplicate = await Effect.runPromise(Database.use(database => database.createNote(note)).pipe(Effect.provide(layer), Effect.flip));
    assert.equal(duplicate._tag, 'CapabilityError');
    const afterFailure = await connections();
    assert.equal(afterFailure.length, 0);
    const badConnection = await Effect.runPromise(Database.use(database => database.getNote(note.id)).pipe(Effect.provide(hyperdriveDatabaseLayer({ connectionString: '' })), Effect.flip));
    assert.equal(badConnection.operation, 'hyperdriveClient');
  } finally {
    await observer.query('DELETE FROM notes WHERE id=$1', [note.id]);
    await observer.end();
  }
});
