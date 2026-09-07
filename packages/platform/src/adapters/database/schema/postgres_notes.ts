import { pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth_schema.js";

/** Notes belong to verified auth identities; timestamps remain ISO text. */
export const postgresNotes = pgTable("notes", {
  id: text("id").primaryKey().notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
});
