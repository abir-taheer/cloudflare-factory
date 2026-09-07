import { Layer } from "effect";
import type  { Pool } from "pg";
import { Database, type NoteRecord } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
/** PostgreSQL note operations share parameterized statements across Pool and request-scoped Client adapters. */
export const makePostgresDatabase = (pool: Pick<Pool, "query">) => Database.of({
  createNote: (note) => capabilityOperation("database", "createNote", async () => {
    await pool.query("INSERT INTO notes (id, text, created_at) VALUES ($1, $2, $3)", [note.id, note.text, note.createdAt]);
  }),
  getNote: (id) => capabilityOperation("database", "getNote", async () => {
    const result = await pool.query<NoteRecord>('SELECT id, text, created_at AS "createdAt" FROM notes WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }),
});
/** PostgreSQL note adapter uses a caller-owned pool; it never closes that pool. */
export const postgresDatabaseLayer = (pool: Pool) => Layer.succeed(Database, makePostgresDatabase(pool));
