import { Effect } from "effect";
import {
  type CloudflareDomainProvider,
  createCloudflareDomainProvider,
} from "../shared/domains/cloudflare-domain-provider.ts";
import type { CloudflareDomain } from "../shared/domains/cloudflare-domain-model.ts";
import type { ProductionDomainState } from "./production-domain-state.ts";
import type { loadProductionContext } from "./production-context.ts";
import { type createProductionStateOperations, productionStateStore } from "./production-state.ts";

type ProductionContext = Effect.Success<ReturnType<typeof loadProductionContext>>;

/** A saved provider identity is required for reuse; a hostname alone never establishes ownership. */
function verifyProductionDomain(domain: ProductionDomainState, live: CloudflareDomain) {
  const expected = domain.identity;

  if (
    live.hostname !== domain.hostname ||
    live.service !== domain.service ||
    live.zone_id !== domain.configuration.zoneId ||
    live.zone_name !== domain.configuration.zoneName ||
    (expected !== null && (live.id !== expected.id || live.cert_id !== expected.cert_id))
  ) {
    throw new Error("Production custom domain identity drift");
  }
}

/** Provider and conditional persistence capabilities share the same ownership boundary in tests and deploys. */
export const attachProductionDomain = (
  provider: CloudflareDomainProvider,
  store: Pick<ReturnType<typeof createProductionStateOperations>, "saveDomains">,
  recorded: ProductionDomainState[],
  intent: ProductionDomainState,
  allowCreate: boolean,
) =>
  Effect.gen(function* () {
    const { configuration: domains, app, hostname, service } = intent;
    const prior = recorded.find((domain) => domain.app === app);

    yield* provider.verifyZone();

    const inventory = yield* provider.listDomains();
    const matches = inventory.filter((domain) => domain.hostname === hostname);
    const live = matches[0];

    if (prior !== undefined) {
      const sameConfiguration =
        prior.configuration.zoneId === domains.zoneId &&
        prior.configuration.zoneName === domains.zoneName &&
        prior.configuration.suffix === domains.suffix;

      if (
        !sameConfiguration ||
        prior.hostname !== hostname ||
        prior.service !== service ||
        prior.phase !== "ready" ||
        prior.identity === null ||
        matches.length !== 1 ||
        live === undefined
      ) {
        throw new Error(
          "Production domain state drift or uncertain creation requires operator reconciliation",
        );
      }

      verifyProductionDomain(prior, live);

      return;
    }

    const dns = yield* provider.listDns(hostname);
    const occupied = matches.length > 0 || dns.length > 0;

    if (!allowCreate || occupied) {
      throw new Error("Production domain creation unauthorized or hostname occupied");
    }

    yield* store.saveDomains([...recorded, intent]);

    const attached = yield* provider.attach(intent);

    verifyProductionDomain(intent, attached);

    const ready: ProductionDomainState = { ...intent, phase: "ready", identity: attached };

    yield* store.saveDomains([...recorded, ready]);

    const readback = (yield* provider.listDomains()).filter(
      (domain) => domain.hostname === hostname,
    );

    const actual = readback[0];

    if (readback.length !== 1 || actual === undefined) {
      throw new Error("Production custom domain readback missing");
    }

    verifyProductionDomain(ready, actual);
  });

/** Attach only an explicitly permitted, vacant hostname after the Worker owner/revision readback. */
export const deployProductionDomain = (context: ProductionContext, app: "api" | "frontend") =>
  Effect.gen(function* () {
    const { config, owner, prefix, credentials, domains, urls, dispatch } = context;
    const store = yield* productionStateStore(config, owner, prefix);
    const state = yield* store.load();

    if (state === null) {
      throw new Error("Production persistent ownership state missing");
    }

    const hostname = new URL(urls[app]).hostname;
    const service = `${prefix}-${app}`;
    const provider = createCloudflareDomainProvider({ ...credentials, domains });

    const intent: ProductionDomainState = {
      configuration: domains,
      app,
      hostname,
      service,
      phase: "creating",
      identity: null,
    };

    yield* attachProductionDomain(
      provider,
      store,
      state.domains,
      intent,
      dispatch.ALLOW_CREATE === "true",
    );
  });
