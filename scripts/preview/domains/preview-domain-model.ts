import { z } from "zod";
import {
  CloudflareDomainConfigurationSchema,
  HostnameSchema,
  ProviderIdSchema,
  WorkerDomainIdSchema,
} from "../../shared/domains/cloudflare-domain-model.ts";

/** Only identities returned by the provider after a saved intent authorize subsequent deletion. */
export const PreviewDomainStateSchema = z
  .object({
    configuration: CloudflareDomainConfigurationSchema,
    app: z.enum(["api", "frontend"]),
    hostname: HostnameSchema,
    service: z.string().regex(/^[a-z0-9-]+$/u),
    phase: z.enum(["planned", "creating", "ready", "detached", "deleted"]),
    domainId: WorkerDomainIdSchema.nullable(),
    certificateId: ProviderIdSchema.nullable(),
    certificatePackId: ProviderIdSchema.nullable(),
    previousCertificateIds: z.array(ProviderIdSchema),
    dnsRecordIds: z.array(ProviderIdSchema),
  })
  .refine((domain) => {
    const hasDomainIdentity = domain.domainId !== null && domain.certificateId !== null;
    const partialIdentity = (domain.domainId === null) !== (domain.certificateId === null);

    if (partialIdentity) {
      return false;
    }

    if (domain.phase === "planned") {
      return (
        !hasDomainIdentity &&
        domain.certificatePackId === null &&
        domain.dnsRecordIds.length === 0 &&
        domain.previousCertificateIds.length === 0
      );
    }

    if (domain.phase === "ready") {
      return (
        hasDomainIdentity && domain.certificatePackId !== null && domain.dnsRecordIds.length > 0
      );
    }

    if (domain.phase === "detached") {
      return hasDomainIdentity;
    }

    return domain.certificatePackId === null || hasDomainIdentity;
  });

export type PreviewDomainState = z.infer<typeof PreviewDomainStateSchema>;
