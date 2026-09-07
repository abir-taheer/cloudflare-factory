import { Effect, Layer } from "effect";
import { Client } from "pg";
import { CapabilityError, Database } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
import { makePostgresDatabase } from "./postgres-database.js";

/** External provisioners must apply migrations/001-notes.sql and attest this version before binding Hyperdrive. */
export const noteDatabaseSchemaVersion = "notes-v1";
/** Only the request-local Hyperdrive connection string crosses this provider boundary. */
export interface HyperdriveDatabaseBinding { readonly connectionString: string }

/** One pg Client per Effect scope; supply per request/invocation, never in a shared Worker ManagedRuntime. */
export const hyperdriveDatabaseLayer = (binding: HyperdriveDatabaseBinding) => Layer.effect(Database, Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        if (binding.connectionString.trim().length === 0) throw new Error("Hyperdrive connection string missing");
        return new Client({ connectionString: binding.connectionString, connectionTimeoutMillis: 10_000 });
      },
      catch: (cause) => new CapabilityError({ capability: "database", operation: "hyperdriveClient", cause }),
    }),
    acquired => Effect.promise(() => acquired.end()),
  );
  yield* capabilityOperation("database", "hyperdriveConnect", () => client.connect());
  return makePostgresDatabase(client);
}));
