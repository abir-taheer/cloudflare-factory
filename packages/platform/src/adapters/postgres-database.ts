import { Layer } from "effect";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import type { Client, Pool } from "pg";
import { Database } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
import { postgresNotes } from "./schema/postgres-notes.js";

/** Shared Drizzle factory; no connection acquisition, migrations, or provider credentials are implicit. */
export const createPostgresDrizzle = (client: Pool | Client) => drizzle({ client, jit: false });
export type PostgresDrizzleDatabase = ReturnType<typeof createPostgresDrizzle>;

/** Drizzle promises stay inside typed Effect operations; caller owns the pg client lifecycle. */
export const makePostgresDatabase = (client: Pool | Client) => {
  const database = createPostgresDrizzle(client);

  return Database.of({
    health: () =>
      capabilityOperation("database", "health", async () => {
        await database.select({ id: postgresNotes.id }).from(postgresNotes).limit(1);
      }),
    createNote: (note) =>
      capabilityOperation("database", "createNote", async () => {
        await database.insert(postgresNotes).values(note);
      }),
    getNote: (id, ownerUserId) =>
      capabilityOperation("database", "getNote", async () => {
        const rows = await database
          .select()
          .from(postgresNotes)
          .where(and(eq(postgresNotes.id, id), eq(postgresNotes.ownerUserId, ownerUserId)))
          .limit(1);

        return rows[0] ?? null;
      }),
  });
};

/** PostgreSQL note adapter uses a caller-owned pool; it never closes that pool. */
export const postgresDatabaseLayer = (pool: Pool) =>
  Layer.succeed(Database, makePostgresDatabase(pool));
