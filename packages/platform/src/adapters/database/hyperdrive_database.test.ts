import { readIntegrationConfiguration } from "../../testing/integration_configuration.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Pool } from "pg";
import { Database } from "../../capability_services.js";
import { hyperdriveDatabaseLayer } from "./hyperdrive_database.js";
import {
  createVerifiedTestUser,
  deleteTestUserAndClosePool,
} from "../../testing/database_fixtures.js";

const integrationConfiguration = Effect.runSync(
  readIntegrationConfiguration(["PLATFORM_INTEGRATION", "DATABASE_URL"]),
);

const enabled = integrationConfiguration["PLATFORM_INTEGRATION"] === "1";

test(
  "Hyperdrive adapter uses a distinct scoped pg Client and closes it on success and failure",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const connectionString = integrationConfiguration["DATABASE_URL"] ?? "";
    const observer = new Pool({ connectionString });
    const marker = `hyperdrive-test-${randomUUID()}`;
    const url = new URL(connectionString);
    url.searchParams.set("application_name", marker);

    const layer = hyperdriveDatabaseLayer({ connectionString: url.toString() });

    const note = {
      id: randomUUID(),
      ownerUserId: randomUUID(),
      text: "Scoped client",
      createdAt: new Date().toISOString(),
    };

    const connections = async () => {
      const result = await observer.query<PostgresConnectionRow>(
        "SELECT pid FROM pg_stat_activity WHERE application_name=$1",
        [marker],
      );

      return result.rows;
    };

    try {
      await Effect.runPromise(createVerifiedTestUser(observer, note.ownerUserId));

      const firstPid = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Database;
          yield* database.createNote(note);

          const active = yield* Effect.promise(connections);

          assert.equal(active.length, 1);
          return active[0]?.pid;
        }).pipe(Effect.provide(layer)),
      );

      const afterSuccess = await connections();
      assert.equal(afterSuccess.length, 0);

      const secondPid = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Database;
          assert.deepEqual(yield* database.getNote(note.id, note.ownerUserId), note);

          const active = yield* Effect.promise(connections);

          assert.equal(active.length, 1);
          return active[0]?.pid;
        }).pipe(Effect.provide(layer)),
      );

      assert.notEqual(firstPid, secondPid);

      const duplicate = await Effect.runPromise(
        Database.use((database) => database.createNote(note)).pipe(
          Effect.provide(layer),
          Effect.flip,
        ),
      );

      assert.equal(duplicate._tag, "CapabilityError");

      const afterFailure = await connections();
      assert.equal(afterFailure.length, 0);

      const badConnection = await Effect.runPromise(
        Database.use((database) => database.getNote(note.id, note.ownerUserId)).pipe(
          Effect.provide(hyperdriveDatabaseLayer({ connectionString: "" })),
          Effect.flip,
        ),
      );

      assert.equal(badConnection.operation, "hyperdriveClient");
    } finally {
      await Effect.runPromise(deleteTestUserAndClosePool(observer, note.ownerUserId));
    }
  },
);

interface PostgresConnectionRow {
  pid: number;
}
