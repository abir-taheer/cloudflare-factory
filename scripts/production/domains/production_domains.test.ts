import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Effect } from "effect";
import { previewDomainFixture } from "../../preview/domains/preview_domain_fixture.ts";
import { createCloudflareDomainProvider } from "../../shared/domains/cloudflare_domain_provider.ts";
import { attachProductionDomain } from "./production_domains.ts";
import { productionDomainConfiguration } from "./production_domain_configuration.ts";
import type { ProductionDomainState } from "./production_domain_state.ts";

process.env["RESOURCE_PREFIX"] = "test";

test("production origin pins reject cross-site, decorated, substituted and identical origins", () => {
  const pins = {
    CLOUDFLARE_ZONE_ID: randomUUID().replaceAll("-", ""),
    CLOUDFLARE_ZONE_NAME: "example.test",
    DOMAIN_SUFFIX: "prod.example.test",
    API_URL: "https://api.prod.example.test",
    FRONTEND_URL: "https://app.prod.example.test",
  };

  const config = {
    ZONE_ID: pins.CLOUDFLARE_ZONE_ID,
    ZONE_NAME: pins.CLOUDFLARE_ZONE_NAME,
    ...pins,
  };

  assert.equal(productionDomainConfiguration(config, pins).urls.api, pins.API_URL);

  for (const origin of [
    "https://api.workers.dev",
    "http://api.prod.example.test",
    `${pins.API_URL}/`,
    "https://api.prod.example.test:8443",
    "https://user@api.prod.example.test",
    pins.FRONTEND_URL,
  ]) {
    assert.throws(() =>
      productionDomainConfiguration({ ...config, API_URL: origin }, { ...pins, API_URL: origin }),
    );
  }

  assert.throws(() =>
    productionDomainConfiguration({ ...config, ZONE_ID: randomUUID().replaceAll("-", "") }, pins),
  );

  assert.throws(() =>
    productionDomainConfiguration({ ...config, FRONTEND_URL: pins.API_URL }, pins),
  );
});

test("production attachment persists identity, refuses drift and never adopts uncertain creations", async (context) => {
  const fixture = previewDomainFixture(context);
  const provider = createCloudflareDomainProvider(fixture.credentials);

  const intent: ProductionDomainState = {
    configuration: fixture.credentials.domains,
    app: "api",
    hostname: "api.preview.example.test",
    service: `prod-${randomUUID()}`,
    phase: "creating",
    identity: null,
  };

  let recorded: ProductionDomainState[] = [];

  const store = {
    saveDomains: (domains: ProductionDomainState[]) =>
      Effect.sync(() => {
        recorded = structuredClone(domains);
      }),
  };

  const attach = (allowCreate = true) =>
    Effect.runPromise(attachProductionDomain(provider, store, recorded, intent, allowCreate));

  await assert.rejects(attach(false));
  assert.equal(fixture.remote.domains.size, 0);
  await attach();

  const saved = recorded[0];

  assert.equal(saved?.phase, "ready");
  assert.equal(saved.identity?.hostname, intent.hostname);
  await attach(false);
  assert.equal(fixture.remote.domains.size, 1);

  fixture.remote.domains.set(saved.identity.id, { ...saved.identity, service: "foreign-worker" });

  await assert.rejects(attach(false));
  assert.equal(fixture.remote.domains.get(saved.identity.id)?.service, "foreign-worker");

  recorded = [];

  await assert.rejects(attach());
  assert.equal(fixture.remote.domains.size, 1);

  fixture.remote.domains.clear();
  fixture.remote.dns.clear();
  fixture.remote.failure = "attach-response";

  await assert.rejects(attach());
  assert.equal(recorded[0]?.phase, "creating");
  await assert.rejects(attach());
  assert.equal(fixture.remote.domains.size, 1);
});

test("production refuses a foreign DNS record without attaching or deleting it", async (context) => {
  const fixture = previewDomainFixture(context);
  const hostname = "api.preview.example.test";
  const id = randomUUID();

  fixture.remote.dns.set(id, { id, name: hostname });

  await assert.rejects(
    Effect.runPromise(
      attachProductionDomain(
        createCloudflareDomainProvider(fixture.credentials),
        { saveDomains: () => Effect.void },
        [],
        {
          configuration: fixture.credentials.domains,
          app: "api",
          hostname,
          service: "owned-worker",
          phase: "creating",
          identity: null,
        },
        true,
      ),
    ),
  );

  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.dns.get(id)?.name, hostname);
});
