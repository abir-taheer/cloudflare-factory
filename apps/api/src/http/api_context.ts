import type { Context } from "effect";
import type { DatabaseService, ObjectStoreService, QueueService } from "@factory/platform";
import type { ApiAuthenticationService, ApiSessionUser } from "./api_authentication.js";
import type { z } from "zod";
import type { ApiConfigurationSchema } from "../api_configuration.js";

/** API settings contain runtime credentials and exact public origins only. */
export type ApiConfiguration = z.infer<typeof ApiConfigurationSchema>;

/** Route effects depend on portable capabilities, never runtime-specific bindings. */
export type ApiServices =
  DatabaseService | ObjectStoreService | QueueService | ApiAuthenticationService;

/** Requests borrow the entry point's scoped service context and cancellation signal. */
export interface ApiRequestBindings {
  readonly configuration: ApiConfiguration;
  readonly services: Context.Context<ApiServices>;
  readonly signal: AbortSignal;
}

/** Request IDs are generated locally, never trusted from incoming headers. */
export interface ApiRequestVariables {
  requestId: string;
  sessionUser: ApiSessionUser;
}

/** Hono keeps provider bindings separate from request metadata. */
export interface ApiHonoEnvironment {
  Bindings: ApiRequestBindings;
  Variables: ApiRequestVariables;
}
