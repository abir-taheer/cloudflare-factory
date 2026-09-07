import { Effect } from "effect";
import { migratePostgres } from "@factory/platform/migrate";

// This child process receives DATABASE_URL only; control-plane credentials are never inherited.
try {
  const url = process.env["DATABASE_URL"];

  if (url === undefined) {
    throw new Error("Database URL missing");
  }

  await Effect.runPromise(migratePostgres(url));
} catch {
  process.stderr.write("PostgreSQL migration failed; connection details suppressed\n");
  process.exitCode = 1;
}
