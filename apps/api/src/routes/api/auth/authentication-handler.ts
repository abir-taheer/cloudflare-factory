import { Effect } from "effect";
import type { Handler } from "hono";
import { ApiAuthentication } from "../../../http/api-authentication.js";
import type { ApiHonoEnvironment } from "../../../http/api-context.js";
import { apiErrorBody, apiHttpStatus } from "../../../http/api-errors.js";
import { runApiEffect } from "../../../http/run-route-effect.js";

/** Better Auth owns its endpoint validation; forward the original request and session cookies. */
export const apiAuthenticationHandler: Handler<ApiHonoEnvironment> = (context) => {
  const authenticationEffect = Effect.gen(function* () {
    const authentication = yield* ApiAuthentication;
    return yield* authentication.handleRequest(context.req.raw);
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        context.json(
          apiErrorBody(context, "Authentication unavailable", "AUTH_UNAVAILABLE", true),
          apiHttpStatus.unavailable,
        ),
      ),
    ),
  );

  return runApiEffect(context, authenticationEffect);
};
