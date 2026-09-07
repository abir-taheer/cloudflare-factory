import { readIntegrationConfiguration } from "./testing/integration-configuration.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Pool } from "pg";
import { Database } from "./capability-services.js";
import { postgresDatabaseLayer } from "./adapters/postgres-database.js";
import { migratePostgres } from "./adapters/migrate-postgres.js";
import { createVerifiedTestUser } from "./testing/database-fixtures.js";

const integrationConfiguration = Effect.runSync(
  readIntegrationConfiguration(["PLATFORM_INTEGRATION", "DATABASE_URL"]),
);

test(
  "generated Drizzle migration creates auth and owned notes in empty Postgres and replays without data loss",
  {
    skip: integrationConfiguration["PLATFORM_INTEGRATION"] !== "1",
    timeout: 30_000,
  },
  async () => {
    const connectionString = integrationConfiguration["DATABASE_URL"] ?? "";
    const admin = new Pool({ connectionString });
    const databaseName = `migration_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;

    const pool = new Pool({ connectionString: url.toString() });

    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      await Effect.runPromise(migratePostgres(url.toString()));

      const note = {
        id: randomUUID(),
        ownerUserId: randomUUID(),
        text: "migration preserves data",
        createdAt: new Date().toISOString(),
      };

      await Effect.runPromise(createVerifiedTestUser(pool, note.ownerUserId));

      const layer = postgresDatabaseLayer(pool);

      await Effect.runPromise(
        Database.use((database) => database.createNote(note)).pipe(Effect.provide(layer)),
      );

      await Effect.runPromise(migratePostgres(url.toString()));

      const persisted = await Effect.runPromise(
        Database.use((database) => database.getNote(note.id, note.ownerUserId)).pipe(
          Effect.provide(layer),
        ),
      );

      assert.deepEqual(persisted, note);

      const hidden = await Effect.runPromise(
        Database.use((database) => database.getNote(note.id, randomUUID())).pipe(
          Effect.provide(layer),
        ),
      );

      assert.equal(hidden, null);

      await Effect.runPromise(
        Database.use((database) => database.health()).pipe(Effect.provide(layer)),
      );

      const tables = await pool.query<PostgresTableRow>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
      );

      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        ["account", "notes", "rate_limit", "session", "user", "verification"],
      );

      const orphan = await Effect.runPromise(
        Database.use((database) =>
          database.createNote({ ...note, id: randomUUID(), ownerUserId: randomUUID() }),
        ).pipe(Effect.provide(layer), Effect.flip),
      );

      assert.equal(orphan.operation, "createNote");
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  },
);

interface PostgresTableRow {
  table_name: string;
}
