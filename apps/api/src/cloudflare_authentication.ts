import { Effect, Layer } from "effect";
import { Email } from "@factory/platform";
import {
  type HyperdriveDatabaseBinding,
  acquireHyperdriveDrizzle,
} from "@factory/platform/cloudflare";
import { makeBetterAuthentication } from "@factory/auth";
import { ApiAuthentication } from "./http/api_authentication.js";
import type { ApiConfiguration } from "./http/api_context.js";

/** Worker auth database connections remain inside the awaited request scope. */
export const cloudflareAuthenticationLayer = (
  binding: HyperdriveDatabaseBinding,
  configuration: ApiConfiguration,
) =>
  Layer.effect(
    ApiAuthentication,
    Effect.gen(function* () {
      const database = yield* acquireHyperdriveDrizzle(binding);
      const email = yield* Email;
      return makeBetterAuthentication(database, configuration, email);
    }),
  );
