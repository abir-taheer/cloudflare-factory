import { z } from "zod";

const hostnameMaximumLength = 253;

export const HostnameSchema = z
  .string()
  .max(hostnameMaximumLength)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

export const ProviderIdSchema = z.string().regex(/^[a-f0-9-]{32,36}$/u);

/** Worker domain IDs also use 40-character hex identifiers, independently of certificate and zone IDs. */
export const WorkerDomainIdSchema = ProviderIdSchema.or(z.string().regex(/^[a-f0-9]{40}$/u));

/** Zone and suffix are independently pinned controller inputs, never app runtime inputs. */
export const CloudflareDomainConfigurationSchema = z
  .object({
    zoneId: z.string().regex(/^[a-f0-9]{32}$/u),
    zoneName: HostnameSchema,
    suffix: HostnameSchema,
  })
  .refine(
    (value) => value.suffix === value.zoneName || value.suffix.endsWith(`.${value.zoneName}`),
  );

/** Cloudflare's domain identity includes the exact Worker and zone, not just a hostname. */
export const CloudflareDomainSchema = z.object({
  id: WorkerDomainIdSchema,
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
export type CloudflareDomainConfiguration = z.infer<typeof CloudflareDomainConfigurationSchema>;
export type CloudflareDomain = z.infer<typeof CloudflareDomainSchema>;
export type CloudflareCertificatePack = z.infer<typeof CloudflareCertificatePackSchema>;
