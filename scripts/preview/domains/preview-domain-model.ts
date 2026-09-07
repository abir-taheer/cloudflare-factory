import { z } from "zod";

const hostnameMaximumLength = 253;

const HostnameSchema = z
  .string()
  .max(hostnameMaximumLength)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

const ProviderIdSchema = z.string().regex(/^[a-f0-9-]{32,36}$/u);

/** Zone and suffix are independently pinned controller inputs, never app runtime inputs. */
export const PreviewDomainConfigurationSchema = z
  .object({
    zoneId: z.string().regex(/^[a-f0-9]{32}$/u),
    zoneName: HostnameSchema,
    suffix: HostnameSchema,
  })
  .refine(
    (value) => value.suffix === value.zoneName || value.suffix.endsWith(`.${value.zoneName}`),
  );

/** Only identities returned by the provider after a saved intent authorize subsequent deletion. */
export const PreviewDomainStateSchema = z
  .object({
    configuration: PreviewDomainConfigurationSchema,
    app: z.enum(["api", "frontend"]),
    hostname: HostnameSchema,
    service: z.string().regex(/^[a-z0-9-]+$/u),
    phase: z.enum(["planned", "creating", "ready", "detached", "deleted"]),
    domainId: ProviderIdSchema.nullable(),
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

/** Cloudflare's domain identity includes the exact Worker and zone, not just a hostname. */
export const CloudflareDomainSchema = z.object({
  id: ProviderIdSchema,
  cert_id: ProviderIdSchema,
  hostname: HostnameSchema,
  service: z.string().min(1),
  zone_id: ProviderIdSchema,
  zone_name: HostnameSchema,
});

/** Certificate packs may contain multiple leaf certificates; shared host coverage is never deleted. */
export const CloudflareCertificatePackSchema = z.object({
  id: ProviderIdSchema,
  hosts: z.array(z.string()),
  type: z.string(),
  certificates: z.array(z.object({ id: ProviderIdSchema, hosts: z.array(z.string()) })),
});

export const CloudflareDnsRecordSchema = z.object({ id: ProviderIdSchema, name: HostnameSchema });
export type PreviewDomainConfiguration = z.infer<typeof PreviewDomainConfigurationSchema>;
export type PreviewDomainState = z.infer<typeof PreviewDomainStateSchema>;
export type CloudflareDomain = z.infer<typeof CloudflareDomainSchema>;
export type CloudflareCertificatePack = z.infer<typeof CloudflareCertificatePackSchema>;
