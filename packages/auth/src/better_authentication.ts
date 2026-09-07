import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { Data, Effect } from "effect";
import type { EmailService } from "@factory/platform";
import type { PostgresDrizzleDatabase } from "@factory/platform/postgres";
import * as authenticationSchema from "@factory/platform/auth-schema";
import type { AuthenticationConfiguration } from "./authentication_configuration.js";
import { deliverAuthenticationEmail } from "./authentication_email.js";

/** Provider causes never cross the public authentication boundary. */
export class ApiAuthenticationError extends Data.TaggedError("ApiAuthenticationError")<
  Record<never, never>
> {}

/** Caller owns the database lifecycle; Worker clients must remain request-scoped. */
export function makeBetterAuthentication(
  database: PostgresDrizzleDatabase,
  config: AuthenticationConfiguration,
  email: EmailService,
) {
  const auth = betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema: authenticationSchema }),
    baseURL: config.apiUrl,
    secret: config.secret,
    trustedOrigins: [...config.frontendOrigins],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverAuthenticationEmail(
          email,
          config.emailFrom,
          user.email,
          "Reset your password",
          url,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverAuthenticationEmail(
          email,
          config.emailFrom,
          user.email,
          "Verify your email address",
          url,
        );
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    advanced: { useSecureCookies: config.environment !== "dev" },
    logger: { disabled: true },
  });

  return {
    handleRequest: (request: Request) =>
      Effect.tryPromise({
        try: () => auth.handler(request),
        catch: () => new ApiAuthenticationError(),
      }).pipe(Effect.withSpan("auth.handleRequest")),
    resolveSession: (headers: Headers) =>
      Effect.tryPromise({
        try: () => auth.api.getSession({ headers }),
        catch: () => new ApiAuthenticationError(),
      }).pipe(Effect.withSpan("auth.resolveSession")),
  };
}

export type { AuthenticationConfiguration } from "./authentication_configuration.js";

export { AuthenticationConfigurationSchema } from "./authentication_configuration.js";
