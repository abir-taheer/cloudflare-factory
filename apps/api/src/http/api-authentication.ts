import { Context, type Effect } from "effect";
import type { ApiAuthenticationError } from "@factory/auth";

/** Session identity comes exclusively from the authentication provider. */
export interface ApiSessionUser {
  readonly id: string;
  readonly emailVerified: boolean;
}

/** Minimal session contract avoids coupling business operations to Better Auth internals. */
export interface ApiVerifiedSession {
  readonly user: ApiSessionUser;
}

/** Better Auth is adapted at entry points; all session work remains an Effect capability. */
export interface ApiAuthenticationService {
  readonly handleRequest: (request: Request) => Effect.Effect<Response, ApiAuthenticationError>;
  readonly resolveSession: (
    headers: Headers,
  ) => Effect.Effect<ApiVerifiedSession | null, ApiAuthenticationError>;
}

/** HTTP middleware uses this provider-neutral session capability. */
export const ApiAuthentication = Context.Service<ApiAuthenticationService>(
  "factory/ApiAuthentication",
);
