import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Effect } from "effect";
import { z } from "zod";
import { previewResourcePlan } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview-state.ts";
import { planPreviewDomains } from "./preview-domain-ownership.ts";
import type {
  CloudflareCertificatePack,
  CloudflareDnsRecordSchema,
  CloudflareDomain,
} from "./preview-domain-model.ts";

const AttachRequestSchema = z.object({
  hostname: z.string(),
  service: z.string(),
  zone_id: z.string(),
});

const httpFailure = 503;
const accountIdLength = 32;
const revisionLength = 40;
type DnsRecord = z.infer<typeof CloudflareDnsRecordSchema>;

const maximumCertificatePageSize = 50;

const InventoryQuerySchema = z.object({
  page: z.coerce.number().int().positive(),
  perPage: z.coerce.number().int().positive().max(maximumCertificatePageSize),
});

function domainInventoryResponse(rows: unknown[], url: URL): Response {
  const parsed = InventoryQuerySchema.safeParse({
    page: url.searchParams.get("page"),
    perPage: url.searchParams.get("per_page"),
  });

  if (!parsed.success) {
    throw new Error("Provider pagination outside documented limits");
  }

  const { page, perPage } = parsed.data;
  const start = (page - 1) * perPage;

  return Response.json({
    success: true,
    result: rows.slice(start, start + perPage),
    result_info: { total_pages: Math.ceil(rows.length / perPage) },
  });
}

type DomainFixtureRemote = ReturnType<typeof previewDomainFixture>["remote"];

function attachDomainResponse(
  init: RequestInit | undefined,
  credentials: PreviewCredentials,
  remote: DomainFixtureRemote,
): Response {
  const body = init?.body;

  if (typeof body !== "string") {
    throw new TypeError("Provider body required");
  }

  const parsed = AttachRequestSchema.safeParse(JSON.parse(body));

  if (!parsed.success) {
    throw new Error("Invalid provider attachment body");
  }

  const id = randomUUID();
  const certId = randomUUID();
  const domain = { ...parsed.data, id, cert_id: certId, zone_name: credentials.domains.zoneName };

  remote.domains.set(id, domain);

  remote.certificates.set(certId, {
    id: certId,
    type: "advanced",
    hosts: [domain.hostname],
    certificates: [{ id: randomUUID(), hosts: [domain.hostname] }],
  });

  remote.dns.set(domain.hostname, { id: randomUUID(), name: domain.hostname });

  if (remote.failure === "attach-response") {
    remote.failure = "";
    return Response.json({ success: false }, { status: httpFailure });
  }

  return Response.json({ success: true, result: domain });
}

function domainProviderResponse(
  input: string | URL | Request,
  init: RequestInit | undefined,
  credentials: PreviewCredentials,
  remote: DomainFixtureRemote,
): Response {
  const source = input instanceof Request ? input.url : input;
  const url = new URL(source);
  const method = init?.method ?? "GET";
  const zonePath = `/client/v4/zones/${credentials.domains.zoneId}`;
  const domainsPath = `/client/v4/accounts/${credentials.accountId}/workers/domains`;
  const ok = (result: unknown) => Response.json({ success: true, result });

  if (url.pathname === zonePath && method === "GET") {
    return ok({
      id: credentials.domains.zoneId,
      name: credentials.domains.zoneName,
      status: "active",
      account: { id: remote.zoneAccountId },
    });
  }

  if (url.pathname === domainsPath && method === "GET") {
    return ok([...remote.domains.values()]);
  }

  if (url.pathname === domainsPath && method === "PUT") {
    return attachDomainResponse(init, credentials, remote);
  }

  if (url.pathname.startsWith(`${domainsPath}/`) && method === "DELETE") {
    const id = url.pathname.slice(domainsPath.length + 1);
    const domain = remote.domains.get(id);

    if (domain !== undefined) {
      remote.dns.delete(domain.hostname);
    }

    remote.domains.delete(id);
    return Response.json({ success: true, errors: [], messages: [] });
  }

  if (url.pathname === `${zonePath}/dns_records` && method === "GET") {
    return domainInventoryResponse(
      [...remote.dns.values()].filter((record) => record.name === url.searchParams.get("name")),
      url,
    );
  }

  const certificatesPath = `${zonePath}/ssl/certificate_packs`;

  if (url.pathname === certificatesPath && method === "GET") {
    return domainInventoryResponse([...remote.certificates.values()], url);
  }

  if (url.pathname.startsWith(`${certificatesPath}/`) && method === "DELETE") {
    if (remote.failure === "certificate-delete") {
      return Response.json({ success: false }, { status: httpFailure });
    }

    const id = url.pathname.slice(certificatesPath.length + 1);

    remote.certificates.delete(id);
    return ok({ id });
  }

  throw new Error("Unexpected domain provider operation");
}

/** Stateful provider boundary models DNS/cert side effects independently from controller manifests. */
export function previewDomainFixture(context: TestContext) {
  const owner = { accountId: "a".repeat(accountIdLength), repositoryId: "123", pr: 42 };

  const credentials: PreviewCredentials = {
    accountId: owner.accountId,
    token: randomUUID(),
    stateBucket: "test-state",
    s3Key: randomUUID(),
    s3Secret: randomUUID(),
    sandbox: false,
    sandboxImage: undefined,
    domains: {
      zoneId: "c".repeat(accountIdLength),
      zoneName: "example.test",
      suffix: "preview.example.test",
    },
  };

  const manifest: PreviewManifest = {
    version: 2,
    owner,
    head: "b".repeat(revisionLength),
    status: "deploying",
    sandbox: false,
    database: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    resources: previewResourcePlan(owner),
  };

  for (const resource of manifest.resources) {
    resource.id = resource.name;
    resource.phase = "ready";
  }

  manifest.domains = planPreviewDomains(manifest, credentials.domains);

  const remote = {
    domains: new Map<string, CloudflareDomain>(),
    certificates: new Map<string, CloudflareCertificatePack>(),
    dns: new Map<string, DnsRecord>(),
    failure: "",
    zoneAccountId: owner.accountId,
  };

  let stored = structuredClone(manifest);

  const state: PreviewStateStore = {
    load: () => Effect.succeed(structuredClone(stored)),
    save: (value) =>
      Effect.sync(() => {
        stored = structuredClone(value);
      }),
    list: () => Effect.succeed([structuredClone(stored)]),
    emptyBucket: () => Effect.void,
    lock: () => Effect.succeed("lock"),
    unlock: () => Effect.void,
  };

  const cf: PreviewCloudflare = {
    lookupResource: (resource) => Effect.succeed(resource.id),
    request: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    create: () => Effect.succeed(randomUUID()),
    remove: () => Effect.void,
  };

  context.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(domainProviderResponse(input, init, credentials, remote)),
  );

  return {
    credentials,
    manifest,
    remote,
    state,
    cf,
    revision: { head: manifest.head, verifyCurrent: Effect.void },
  };
}
