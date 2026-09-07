import { z } from "zod";
import {
  CloudflareDomainConfigurationSchema,
  CloudflareDomainSchema,
} from "../../shared/domains/cloudflare_domain_model.ts";

/** Persistent production attachments have no expiry, certificate inventory or deletion phase. */
export const ProductionDomainStateSchema = CloudflareDomainSchema.pick({
  hostname: true,
  service: true,
})
  .extend({
    configuration: CloudflareDomainConfigurationSchema,
    app: z.enum(["api", "frontend"]),
    phase: z.enum(["creating", "ready"]),
    identity: CloudflareDomainSchema.nullable(),
  })
  .refine((domain) => (domain.phase === "ready") === (domain.identity !== null));

export type ProductionDomainState = z.infer<typeof ProductionDomainStateSchema>;
