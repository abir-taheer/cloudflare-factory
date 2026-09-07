import { Layer } from "effect";
import type { SendEmail } from "@cloudflare/workers-types";
import { cloudflareEmailLayer, r2ObjectStoreLayer } from "@factory/platform/cloudflare";
import type { CloudflarePlatformBindings } from "@factory/platform/cloudflare";
import { captureEmailLayer } from "@factory/platform/capture-email";
import type { ApiConfiguration } from "./http/api-context.js";

/** Production email binding is supplied only by deployment configuration. */
export interface ApiEmailBindings {
  readonly EMAIL?: SendEmail;
}

/** Preview capture uses only its private object store; production requires the real email binding. */
export const cloudflareAuthenticationEmailLayer = (
  bindings: CloudflarePlatformBindings & ApiEmailBindings,
  configuration: ApiConfiguration,
) => {
  if (configuration.environment === "preview" && configuration.emailDelivery === "capture") {
    return captureEmailLayer.pipe(Layer.provide(r2ObjectStoreLayer(bindings.OBJECTS)));
  }

  if (
    configuration.environment !== "prod" ||
    configuration.emailDelivery !== "cloudflare" ||
    bindings.EMAIL === undefined
  ) {
    throw new Error("API email binding missing or incompatible with environment");
  }

  return cloudflareEmailLayer(bindings.EMAIL, (message) => ({ ...message }));
};
