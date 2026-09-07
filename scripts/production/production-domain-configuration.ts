import { z } from "zod";
import { CloudflareDomainConfigurationSchema } from "../shared/domains/cloudflare-domain-model.ts";
import { parseProductionValue } from "./production-model.ts";

/** Public origins are independently pinned alongside the private zone identity. */
export const ProductionDomainPinsSchema = z.object({
  CLOUDFLARE_ZONE_ID: CloudflareDomainConfigurationSchema.shape.zoneId,
  CLOUDFLARE_ZONE_NAME: CloudflareDomainConfigurationSchema.shape.zoneName,
  DOMAIN_SUFFIX: CloudflareDomainConfigurationSchema.shape.suffix,
  API_URL: z.url(),
  FRONTEND_URL: z.url(),
});

/** Require distinct HTTPS sibling hosts inside the verified zone, with no URL decorations. */
export function productionDomainConfiguration(
  config: Record<string, unknown>,
  pins: z.infer<typeof ProductionDomainPinsSchema>,
) {
  const domains = parseProductionValue(CloudflareDomainConfigurationSchema, {
    zoneId: config["ZONE_ID"],
    zoneName: config["ZONE_NAME"],
    suffix: config["DOMAIN_SUFFIX"],
  });

  if (
    domains.zoneId !== pins.CLOUDFLARE_ZONE_ID ||
    domains.zoneName !== pins.CLOUDFLARE_ZONE_NAME ||
    domains.suffix !== pins.DOMAIN_SUFFIX ||
    config["API_URL"] !== pins.API_URL ||
    config["FRONTEND_URL"] !== pins.FRONTEND_URL ||
    pins.API_URL === pins.FRONTEND_URL
  ) {
    throw new Error("Production domain pins mismatch");
  }

  for (const origin of [pins.API_URL, pins.FRONTEND_URL]) {
    const url = new URL(origin);
    const label = url.hostname.slice(0, -(domains.suffix.length + 1));

    const sibling =
      url.hostname.endsWith(`.${domains.suffix}`) &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label);

    if (url.protocol !== "https:" || url.origin !== origin || url.port !== "" || !sibling) {
      throw new Error("Production origins must be exact HTTPS sibling hosts");
    }
  }

  return { domains, urls: { api: pins.API_URL, frontend: pins.FRONTEND_URL } };
}
