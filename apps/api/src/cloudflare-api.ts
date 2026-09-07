import { ConfigProvider, Effect, Layer } from "effect";
import {
  type CloudflarePlatformBindings,
  cloudflarePlatformLayer,
} from "@factory/platform/cloudflare";
import { parseApiConfiguration } from "./api-configuration.js";
import { handleApiRequest } from "./api-handler.js";
import type { ApiConfiguration } from "./http/api-context.js";
import { cloudflareAuthenticationLayer } from "./cloudflare-authentication.js";
import {
  type ApiEmailBindings,
  cloudflareAuthenticationEmailLayer,
} from "./cloudflare-authentication-email.js";

interface ApiBindings extends CloudflarePlatformBindings, ApiEmailBindings {
  readonly ENVIRONMENT: ApiConfiguration["environment"];
  readonly API_URL: string;
  readonly FRONTEND_ORIGINS: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly EMAIL_FROM: string;
  readonly EMAIL_DELIVERY: ApiConfiguration["emailDelivery"];
}

export default {
  fetch(request: Request, bindings: ApiBindings): Promise<Response> {
    return Effect.runPromise(
      parseApiConfiguration(ConfigProvider.fromUnknown(bindings)).pipe(
        Effect.flatMap((configuration) => {
          const authentication = cloudflareAuthenticationLayer(
            bindings.HYPERDRIVE,
            configuration,
          ).pipe(Layer.provide(cloudflareAuthenticationEmailLayer(bindings, configuration)));

          return handleApiRequest(request, configuration).pipe(
            Effect.provide(Layer.mergeAll(cloudflarePlatformLayer(bindings), authentication)),
          );
        }),
        Effect.orElseSucceed(() =>
          Response.json(
            { error: "Service not configured" },
            { status: 503, headers: { "cache-control": "no-store" } },
          ),
        ),
      ),
      { signal: request.signal },
    );
  },
};
