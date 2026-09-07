import { Layer } from "effect";
import type  { D1Database } from "@cloudflare/workers-types";
import { Database, type NoteRecord } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
/** D1 note adapter; apply migrations/001-notes.sql before serving requests. */
export const d1DatabaseLayer = (database: D1Database) => Layer.succeed(Database, Database.of({
  createNote: (note) => capabilityOperation("database", "createNote", async () => {
    await database.prepare("INSERT INTO notes (id, text, created_at) VALUES (?, ?, ?)").bind(note.id, note.text, note.createdAt).run();
  }),
  getNote: (id) => capabilityOperation("database", "getNote", () => database.prepare("SELECT id, text, created_at AS createdAt FROM notes WHERE id = ?").bind(id).first<NoteRecord>()),
}));
