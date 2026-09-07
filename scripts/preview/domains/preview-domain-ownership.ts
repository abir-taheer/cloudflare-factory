import type {
  CloudflareCertificatePack,
  CloudflareDomain,
  CloudflareDomainConfiguration,
} from "../../shared/domains/cloudflare-domain-model.ts";
import { PreviewFailure, previewResource } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import { type PreviewDomainState, PreviewDomainStateSchema } from "./preview-domain-model.ts";

const previewDomainCount = 2;

/** Persisted scope cannot be reinterpreted when an operator changes deployment configuration. */
export function validatePreviewDomainScope(
  manifest: PreviewManifest,
  configuration: CloudflareDomainConfiguration,
) {
  const domains = manifest.domains ?? [];

  if (domains.length > 0 && domains.length !== previewDomainCount) {
    throw new PreviewFailure({ operation: "Preview domain plan incomplete" });
  }

  const apps = new Set<string>();

  for (const domain of domains) {
    const service = previewResource(manifest, domain.app).name;

    const matches =
      domain.configuration.zoneId === configuration.zoneId &&
      domain.configuration.zoneName === configuration.zoneName &&
      domain.configuration.suffix === configuration.suffix &&
      domain.service === service &&
      domain.hostname === `${service}.${configuration.suffix}`;

    if (!matches || apps.has(domain.app)) {
      throw new PreviewFailure({ operation: "Preview domain ownership or configuration drift" });
    }

    apps.add(domain.app);
  }

  return domains;
}

/** A domain plan is controller-generated and contains no application input or credential material. */
export function planPreviewDomains(
  manifest: PreviewManifest,
  configuration: CloudflareDomainConfiguration,
) {
  const existing = validatePreviewDomainScope(manifest, configuration);

  if (existing.length > 0) {
    return existing;
  }

  return (["api", "frontend"] as const).map((app) => {
    const service = previewResource(manifest, app).name;

    const parsed = PreviewDomainStateSchema.safeParse({
      configuration,
      app,
      service,
      hostname: `${service}.${configuration.suffix}`,
      phase: "planned",
      domainId: null,
      certificateId: null,
      certificatePackId: null,
      previousCertificateIds: [],
      dnsRecordIds: [],
    });

    if (!parsed.success) {
      throw new PreviewFailure({ operation: "Preview domain hostname invalid" });
    }

    return parsed.data;
  });
}

/** Hostname equality alone never authorizes adopting a domain or deleting its certificate. */
export function assertPreviewDomainIdentity(
  domain: PreviewDomainState,
  live: CloudflareDomain,
): void {
  const matches =
    live.hostname === domain.hostname &&
    live.service === domain.service &&
    live.zone_id === domain.configuration.zoneId &&
    live.zone_name === domain.configuration.zoneName;

  const identityDrift =
    (domain.domainId !== null && domain.domainId !== live.id) ||
    (domain.certificateId !== null && domain.certificateId !== live.cert_id);

  if (!matches || identityDrift) {
    throw new PreviewFailure({ operation: "Preview custom domain identity drift" });
  }
}

function sameCertificateId(left: string, right: string): boolean {
  return left.replaceAll("-", "") === right.replaceAll("-", "");
}

/** Cloudflare may return a leaf or pack ID; resolve that exact ID rather than adopting by hostname. */
export function ownedPreviewCertificate(
  domain: PreviewDomainState,
  packs: CloudflareCertificatePack[],
) {
  const matches = packs.filter((pack) => {
    if (domain.certificatePackId !== null) {
      return pack.id === domain.certificatePackId;
    }

    if (domain.certificateId === null) {
      return false;
    }

    const certificateId = domain.certificateId;

    return (
      sameCertificateId(pack.id, certificateId) ||
      pack.certificates.some((certificate) => sameCertificateId(certificate.id, certificateId))
    );
  });

  if (matches.length > 1) {
    throw new PreviewFailure({ operation: "Preview certificate identity ambiguous" });
  }

  const pack = matches[0];

  if (pack === undefined) {
    return null;
  }

  const exclusiveHosts =
    pack.hosts.length === 1 &&
    pack.hosts[0] === domain.hostname &&
    pack.certificates.every(
      (certificate) => certificate.hosts.length === 1 && certificate.hosts[0] === domain.hostname,
    );

  const preexisting = domain.previousCertificateIds.some((id) => sameCertificateId(id, pack.id));

  if (pack.type !== "advanced" || !exclusiveHosts || preexisting) {
    throw new PreviewFailure({ operation: "Preview certificate is shared or not owned" });
  }

  return pack;
}
