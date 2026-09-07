import { fileURLToPath } from "node:url";
import path from "node:path";
import { ConfigProvider, Effect } from "effect";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { capabilityOperation } from "./capability-operation.js";

/** Trusted controller entrypoint only; this module never belongs in Worker or domain imports. */
export const migratePostgres = (databaseUrl: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        capabilityOperation("database", "migrationConnect", async () => {
          const url = new URL(databaseUrl);
          const isPostgresProtocol = ["postgres:", "postgresql:"].includes(url.protocol);

          if (!isPostgresProtocol) {
            throw new Error("PostgreSQL URL required");
          }

          return new Pool({
            connectionString: databaseUrl,
            max: 1,
            connectionTimeoutMillis: 10_000,
          });
        }),
        (acquired) =>
          Effect.promise(() => acquired.end()).pipe(
            Effect.withSpan("platform.database.migrationClose"),
          ),
      );

      yield* capabilityOperation("database", "migrate", async () => {
        await migrate(drizzle({ client: pool, jit: false }), {
          migrationsFolder: fileURLToPath(new URL("../../migrations/drizzle", import.meta.url)),
        });
      });
    }),
  ).pipe(Effect.withSpan("platform.database.migrate"));

if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    const databaseSetting = await Effect.runPromise(
      ConfigProvider.fromEnv().load(["DATABASE_URL"]),
    );

    await Effect.runPromise(migratePostgres(databaseSetting?.value ?? ""));
  } catch {
    process.stderr.write("PostgreSQL migration failed\n");
    process.exitCode = 1;
  }
}
