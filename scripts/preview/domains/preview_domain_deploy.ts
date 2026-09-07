import { Effect } from "effect";
import { PreviewFailure, previewResource } from "../preview_model.ts";
import type { PreviewManifest } from "../preview_model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview_cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview_state.ts";
import type { PreviewDeploymentRevision } from "../cloudflare/preview_worker_deploy.ts";
import {
  type CloudflareDomainProvider,
  createCloudflareDomainProvider,
} from "../../shared/domains/cloudflare_domain_provider.ts";
import {
  assertPreviewDomainIdentity,
  ownedPreviewCertificate,
  planPreviewDomains,
} from "./preview_domain_ownership.ts";
import type { PreviewDomainState } from "./preview_domain_model.ts";

const certificateReadbackAttempts = 20;
const certificateReadbackDelay = "3 seconds";

function recordPreviewDomainCertificate(
  manifest: PreviewManifest,
  domain: PreviewDomainState,
  provider: CloudflareDomainProvider,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < certificateReadbackAttempts; attempt++) {
      const packs = yield* provider.listCertificates();

      const pack = yield* Effect.try({
        try: () => ownedPreviewCertificate(domain, packs),
        catch: () => new PreviewFailure({ operation: "Preview certificate ownership failed" }),
      });

      if (pack !== null) {
        domain.certificatePackId = pack.id;

        const records = yield* provider.listDns(domain.hostname);

        if (records.length > 0) {
          if (records.some((record) => record.name !== domain.hostname)) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Preview DNS readback mismatch" }),
            );
          }

          const dnsDrift =
            domain.phase === "ready" &&
            (records.length !== domain.dnsRecordIds.length ||
              records.some((record) => !domain.dnsRecordIds.includes(record.id)));

          if (dnsDrift) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Preview existing DNS identity drift" }),
            );
          }

          domain.dnsRecordIds = records.map((record) => record.id);
          domain.phase = "ready";
          yield* state.save(manifest);
          return yield* Effect.void;
        }
      }

      yield* Effect.sleep(certificateReadbackDelay);
    }

    return yield* Effect.fail(
      new PreviewFailure({ operation: "Preview certificate readback pending; state retained" }),
    );
  });
}

/** A saved absence check permits recovery of an interrupted attach only to the exact owned Worker. */
function attachPreviewDomain(
  manifest: PreviewManifest,
  domain: PreviewDomainState,
  provider: CloudflareDomainProvider,
  state: PreviewStateStore,
) {
  return Effect.gen(function* () {
    const matches = (yield* provider.listDomains()).filter(
      (live) => live.hostname === domain.hostname,
    );

    if (matches.length > 1 || domain.phase === "deleted" || domain.phase === "detached") {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview domain requires completed cleanup" }),
      );
    }

    let live = matches[0];

    if (domain.phase === "planned") {
      const dns = yield* provider.listDns(domain.hostname);

      if (live !== undefined || dns.length > 0) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview hostname already occupied; refusing adoption" }),
        );
      }

      domain.previousCertificateIds = (yield* provider.listCertificates()).map((pack) => pack.id);
      domain.phase = "creating";
      yield* state.save(manifest);
    }

    if (live === undefined) {
      if (domain.domainId !== null || domain.phase === "ready") {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview domain disappeared; refusing replacement" }),
        );
      }

      if ((yield* provider.listDns(domain.hostname)).length > 0) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview hostname DNS collision" }),
        );
      }

      live = yield* provider.attach(domain);
    }

    yield* Effect.try({
      try: () => {
        assertPreviewDomainIdentity(domain, live);
      },
      catch: () => new PreviewFailure({ operation: "Preview domain attachment ownership failed" }),
    });

    domain.domainId = live.id;
    domain.certificateId = live.cert_id;
    yield* state.save(manifest);

    const readback = (yield* provider.listDomains()).filter(
      (entry) => entry.hostname === domain.hostname,
    );

    const attached = readback[0];

    if (readback.length !== 1 || attached === undefined) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview domain attachment readback pending" }),
      );
    }

    yield* Effect.try({
      try: () => {
        assertPreviewDomainIdentity(domain, attached);
      },
      catch: () => new PreviewFailure({ operation: "Preview domain readback identity drift" }),
    });

    yield* recordPreviewDomainCertificate(manifest, domain, provider, state);
    return yield* Effect.void;
  });
}

/** Workers stay private until their exact-head deployment and persisted ownership are verified. */
export function deployPreviewDomains(
  manifest: PreviewManifest,
  credentials: PreviewCredentials,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
  revision: PreviewDeploymentRevision,
) {
  return Effect.gen(function* () {
    manifest.domains = yield* Effect.try({
      try: () => planPreviewDomains(manifest, credentials.domains),
      catch: () => new PreviewFailure({ operation: "Preview domain configuration drift" }),
    });

    yield* state.save(manifest);

    const provider = createCloudflareDomainProvider(credentials);
    yield* provider.verifyZone();

    for (const domain of manifest.domains) {
      yield* revision.verifyCurrent;

      const worker = previewResource(manifest, domain.app);
      const live = yield* cf.lookupResource(worker);

      if (worker.phase !== "ready" || worker.id === null || worker.id !== live) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview domain Worker ownership mismatch" }),
        );
      }

      yield* attachPreviewDomain(manifest, domain, provider, state);
    }

    return yield* Effect.void;
  });
}
