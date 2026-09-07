import { Effect, Layer } from "effect";
import { Client } from "pg";
import { CapabilityError, Database } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
import { createPostgresDrizzle, makePostgresDatabase } from "./postgres-database.js";

/** Only the request-local Hyperdrive connection string crosses this provider boundary. */
export interface HyperdriveDatabaseBinding {
  readonly connectionString: string;
}

/** One pg Client per Effect scope; supply per request/invocation, never in a shared Worker ManagedRuntime. */
const acquireHyperdriveClient = Effect.fn("platform.hyperdrive.acquire")(function* (
  binding: HyperdriveDatabaseBinding,
) {
  const client = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        if (binding.connectionString.trim().length === 0) {
          throw new Error("Hyperdrive connection string missing");
        }

        return new Client({
          connectionString: binding.connectionString,
          connectionTimeoutMillis: 10_000,
        });
      },
      catch: (cause) =>
        new CapabilityError({ capability: "database", operation: "hyperdriveClient", cause }),
    }).pipe(Effect.withSpan("platform.database.hyperdriveClient")),
    (acquired) =>
      Effect.promise(() => acquired.end()).pipe(
        Effect.withSpan("platform.database.hyperdriveClose"),
      ),
  );

  yield* capabilityOperation("database", "hyperdriveConnect", () => client.connect());
  return client;
});

/** Keep the returned database inside the enclosing request Scope, including the awaited auth handler. */
export const acquireHyperdriveDrizzle = Effect.fn("platform.hyperdrive.drizzle")(function* (
  binding: HyperdriveDatabaseBinding,
) {
  const client = yield* acquireHyperdriveClient(binding);
  return createPostgresDrizzle(client);
});

export const hyperdriveDatabaseLayer = (binding: HyperdriveDatabaseBinding) =>
  Layer.effect(
    Database,
    acquireHyperdriveClient(binding).pipe(Effect.map((client) => makePostgresDatabase(client))),
  );
