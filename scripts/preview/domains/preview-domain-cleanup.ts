import { Effect } from "effect";
import { PreviewFailure, previewResource } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview-state.ts";
import {
  type CloudflareDomainProvider,
  createCloudflareDomainProvider,
} from "../../shared/domains/cloudflare-domain-provider.ts";
import {
  assertPreviewDomainIdentity,
  ownedPreviewCertificate,
  validatePreviewDomainScope,
} from "./preview-domain-ownership.ts";
import type { PreviewDomainState } from "./preview-domain-model.ts";

function removePreviewDomainCertificate(
  manifest: PreviewManifest,
  domain: PreviewDomainState,
  provider: CloudflareDomainProvider,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    const packs = yield* provider.listCertificates();

    const pack = yield* Effect.try({
      try: () => ownedPreviewCertificate(domain, packs),
      catch: () =>
        new PreviewFailure({ operation: "Preview certificate deletion ownership failed" }),
    });

    if (pack === null && domain.certificatePackId === null) {
      return yield* Effect.fail(
        new PreviewFailure({
          operation: "Preview certificate identity unresolved; state retained",
        }),
      );
    }

    if (pack !== null) {
      // A wildcard covers child records as well as a literal wildcard DNS record.
      for (const hostname of pack.hosts.filter((host) => host !== domain.hostname)) {
        const records = yield* hostname.startsWith("*.")
          ? provider.listDnsDescendants(domain.hostname)
          : provider.listDns(hostname);

        if (records.length > 0) {
          return yield* Effect.fail(
            new PreviewFailure({
              operation: "Preview certificate additional hostname in use; refusing deletion",
            }),
          );
        }
      }

      const references = yield* provider.listDomains();

      const certificateIds = new Set(
        [pack.id, ...pack.certificates.map((certificate) => certificate.id)].map((id) =>
          id.replaceAll("-", ""),
        ),
      );

      const referenced = references.some((reference) =>
        certificateIds.has(reference.cert_id.replaceAll("-", "")),
      );

      if (referenced) {
        return yield* Effect.fail(
          new PreviewFailure({
            operation: "Preview certificate still referenced; refusing deletion",
          }),
        );
      }

      domain.certificatePackId = pack.id;
      yield* state.save(manifest);
      yield* provider.deleteCertificate(pack.id);

      if ((yield* provider.listCertificates()).some((remaining) => remaining.id === pack.id)) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview certificate deletion readback pending" }),
        );
      }
    }

    domain.phase = "deleted";
    yield* state.save(manifest);
    return yield* Effect.void;
  });
}

/** Detach only the saved identity, then verify managed DNS absence before removing its exclusive certificate. */
function detachPreviewDomain(
  manifest: PreviewManifest,
  domain: PreviewDomainState,
  provider: CloudflareDomainProvider,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    const matches = (yield* provider.listDomains()).filter(
      (live) => live.hostname === domain.hostname,
    );

    const live = matches[0];
    const wasNeverAttached = domain.phase === "planned" || domain.phase === "deleted";

    if (matches.length > 1 || (wasNeverAttached && live !== undefined)) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview domain cleanup found foreign hostname" }),
      );
    }

    if (live !== undefined) {
      yield* Effect.try({
        try: () => {
          assertPreviewDomainIdentity(domain, live);
        },
        catch: () => new PreviewFailure({ operation: "Preview domain deletion identity drift" }),
      });

      const records = yield* provider.listDns(domain.hostname);

      const dnsDrift =
        domain.phase === "ready" &&
        records.some((record) => !domain.dnsRecordIds.includes(record.id));

      if (dnsDrift) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview DNS identity drift; refusing detach" }),
        );
      }

      domain.domainId = live.id;
      domain.certificateId = live.cert_id;
      yield* state.save(manifest);
      yield* provider.detach(live.id);
    }

    const domainsRemain = (yield* provider.listDomains()).some(
      (remaining) => remaining.hostname === domain.hostname || remaining.id === domain.domainId,
    );

    const dnsRemains = (yield* provider.listDns(domain.hostname)).length > 0;

    if (domainsRemain || dnsRemains) {
      return yield* Effect.fail(
        new PreviewFailure({
          operation: "Preview domain or managed DNS removal pending; state retained",
        }),
      );
    }

    if (wasNeverAttached) {
      domain.phase = "deleted";
      yield* state.save(manifest);
      return yield* Effect.void;
    }

    if (domain.certificateId === null) {
      const unresolved = (yield* provider.listCertificates()).some(
        (pack) =>
          pack.hosts.includes(domain.hostname) && !domain.previousCertificateIds.includes(pack.id),
      );

      if (unresolved) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview interrupted domain certificate unresolved" }),
        );
      }

      domain.phase = "deleted";
      yield* state.save(manifest);
      return yield* Effect.void;
    }

    domain.phase = "detached";
    yield* state.save(manifest);
    return yield* Effect.void;
  });
}

/** Legacy manifests with no domain intent retain their original cleanup path; no domain is inferred. */
export function cleanupPreviewDomains(
  manifest: PreviewManifest,
  credentials: PreviewCredentials,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    const domains = yield* Effect.try({
      try: () => validatePreviewDomainScope(manifest, credentials.domains),
      catch: () => new PreviewFailure({ operation: "Preview domain cleanup configuration drift" }),
    });

    if (domains.length === 0) {
      return yield* Effect.void;
    }

    const provider = createCloudflareDomainProvider(credentials);
    yield* provider.verifyZone();

    for (const domain of domains) {
      if (domain.domainId === null && domain.phase === "creating") {
        const worker = previewResource(manifest, domain.app);
        const live = yield* cf.lookupResource(worker);

        if (worker.id === null || worker.id !== live) {
          return yield* Effect.fail(
            new PreviewFailure({
              operation: "Preview interrupted domain Worker ownership missing",
            }),
          );
        }
      }

      yield* detachPreviewDomain(manifest, domain, provider, state);
    }

    for (const domain of domains) {
      if (domain.phase === "detached") {
        yield* removePreviewDomainCertificate(manifest, domain, provider, state);
      }
    }

    return yield* Effect.void;
  });
}
