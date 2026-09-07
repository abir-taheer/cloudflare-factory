import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { Email } from "@factory/platform";
import { createPostgresDrizzle } from "@factory/platform/postgres";
import { makeBetterAuthentication } from "@factory/auth";
import { ApiAuthentication } from "./http/api_authentication.js";
import type { ApiConfiguration } from "./http/api_context.js";

/** A shared Node auth pool closes with the server scope; SMTP comes from portable providers. */
export const nodeAuthenticationLayer = (databaseUrl: string, configuration: ApiConfiguration) =>
  Layer.effect(
    ApiAuthentication,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(
          () => new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 }),
        ),
        (client) => Effect.promise(() => client.end()),
      );

      const email = yield* Email;
      return makeBetterAuthentication(createPostgresDrizzle(pool), configuration, email);
    }),
  );
