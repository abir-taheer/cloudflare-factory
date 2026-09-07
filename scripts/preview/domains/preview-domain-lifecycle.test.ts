import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Effect } from "effect";
import { previewDomainFixture } from "./preview-domain-fixture.ts";
import { deployPreviewDomains } from "./preview-domain-deploy.ts";
import { cleanupPreviewDomains } from "./preview-domain-cleanup.ts";
import { parsePreviewManifest } from "../preview-model.ts";
import { previewPublicUrls } from "../cloudflare/preview-worker-config.ts";

process.env["RESOURCE_PREFIX"] = "test";

function deploy(fixture: ReturnType<typeof previewDomainFixture>) {
  return Effect.runPromise(
    deployPreviewDomains(
      fixture.manifest,
      fixture.credentials,
      fixture.cf,
      fixture.state,
      fixture.revision,
    ),
  );
}

function cleanup(fixture: ReturnType<typeof previewDomainFixture>) {
  return Effect.runPromise(
    cleanupPreviewDomains(fixture.manifest, fixture.credentials, fixture.cf, fixture.state),
  );
}

test("sibling origins cleanup only their domains, DNS and certificates with result-less DELETE responses", async (context) => {
  const fixture = previewDomainFixture(context);
  const unrelatedId = randomUUID();

  fixture.remote.certificates.set(unrelatedId, {
    id: unrelatedId,
    type: "universal",
    hosts: [fixture.credentials.domains.zoneName],
    certificates: [],
  });

  const urls = previewPublicUrls(fixture.manifest, fixture.credentials);

  assert.notEqual(new URL(urls.api).hostname, new URL(urls.frontend).hostname);

  assert.equal(
    new URL(urls.api).hostname.split(".").slice(1).join("."),
    fixture.credentials.domains.suffix,
  );

  await deploy(fixture);
  assert.equal(fixture.remote.domains.size, 2);
  assert.equal(fixture.remote.dns.size, 2);
  await cleanup(fixture);
  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.dns.size, 0);
  assert.deepEqual([...fixture.remote.certificates.keys()], [unrelatedId]);

  assert.equal(
    fixture.manifest.domains?.every((domain) => domain.phase === "deleted"),
    true,
  );
});

test("interrupted attach recovers only the saved intent and exact owned Worker", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.failure = "attach-response";
  await assert.rejects(deploy(fixture));

  const stored = await Effect.runPromise(fixture.state.load(fixture.manifest.owner));

  assert.equal(stored?.domains?.[0]?.phase, "creating");
  assert.equal(fixture.remote.domains.size, 1);
  await deploy(fixture);
  assert.equal(fixture.remote.domains.size, 2);
  await cleanup(fixture);
  assert.equal(fixture.remote.certificates.size, 0);
});

test("existing DNS is not replaced and a foreign domain is not adopted", async (context) => {
  const fixture = previewDomainFixture(context);
  const hostname = new URL(previewPublicUrls(fixture.manifest, fixture.credentials).api).hostname;
  const record = { id: randomUUID(), name: hostname };

  fixture.remote.dns.set(hostname, record);
  await assert.rejects(deploy(fixture));
  assert.equal(fixture.remote.domains.size, 0);
  assert.deepEqual(fixture.remote.dns.get(hostname), record);
  fixture.remote.dns.clear();

  const id = randomUUID();

  fixture.remote.domains.set(id, {
    id,
    cert_id: randomUUID(),
    hostname,
    service: "unrelated-worker",
    zone_id: fixture.credentials.domains.zoneId,
    zone_name: fixture.credentials.domains.zoneName,
  });

  await assert.rejects(deploy(fixture));
  await assert.rejects(cleanup(fixture));
  assert.equal(fixture.remote.domains.get(id)?.service, "unrelated-worker");
});

test("zone account mismatch fails before any domain allocation", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.zoneAccountId = "f".repeat(32);
  await assert.rejects(deploy(fixture));
  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.certificates.size, 0);
});

test("replacement domain identity is preserved and cleanup fails closed", async (context) => {
  const fixture = previewDomainFixture(context);
  await deploy(fixture);

  const original = [...fixture.remote.domains.values()][0];

  assert.ok(original);
  fixture.remote.domains.delete(original.id);

  const replacement = { ...original, id: randomUUID() };

  fixture.remote.domains.set(replacement.id, replacement);
  await assert.rejects(cleanup(fixture));
  assert.ok(fixture.remote.domains.has(replacement.id));
  assert.equal(fixture.remote.certificates.size, 2);
});

test("certificate deletion outage retains retryable state after ingress is detached", async (context) => {
  const fixture = previewDomainFixture(context);

  await deploy(fixture);
  fixture.remote.failure = "certificate-delete";
  await assert.rejects(cleanup(fixture));
  assert.equal(fixture.manifest.domains?.[0]?.phase, "detached");
  assert.equal(fixture.remote.certificates.size, 2);
  fixture.remote.failure = "";
  await cleanup(fixture);
  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.certificates.size, 0);
});

test("shared certificate coverage is never deleted", async (context) => {
  const fixture = previewDomainFixture(context);
  await deploy(fixture);

  const pack = [...fixture.remote.certificates.values()][0];

  assert.ok(pack);
  pack.hosts.push("unrelated.example.test");
  await assert.rejects(cleanup(fixture));
  assert.deepEqual(fixture.remote.certificates.get(pack.id), pack);
});

test("changed suffix cannot reinterpret persisted deletion targets", async (context) => {
  const fixture = previewDomainFixture(context);

  await deploy(fixture);
  fixture.credentials.domains.suffix = "other.example.test";
  await assert.rejects(cleanup(fixture));
  await assert.rejects(deploy(fixture));
  assert.equal(fixture.remote.domains.size, 2);
});

test("manifest rejects ready domain state without recorded ownership IDs", (context) => {
  const fixture = previewDomainFixture(context);
  const domain = fixture.manifest.domains?.[0];

  assert.ok(domain);
  domain.phase = "ready";
  assert.throws(() => parsePreviewManifest(fixture.manifest, fixture.manifest.owner));
});

test("redeploy rejects replacement DNS instead of overwriting its saved identity", async (context) => {
  const fixture = previewDomainFixture(context);
  await deploy(fixture);

  const record = [...fixture.remote.dns.values()][0];
  assert.ok(record);

  const replacement = { ...record, id: randomUUID() };

  fixture.remote.dns.set(record.name, replacement);
  await assert.rejects(deploy(fixture));
  await assert.rejects(cleanup(fixture));
  assert.deepEqual(fixture.remote.dns.get(record.name), replacement);
});

test("certificate inventory follows documented page limits and preserves unrelated later pages", async (context) => {
  const fixture = previewDomainFixture(context);
  const unrelatedIds = Array.from({ length: 51 }, () => randomUUID());

  for (const id of unrelatedIds) {
    fixture.remote.certificates.set(id, {
      id,
      type: "universal",
      hosts: [fixture.credentials.domains.zoneName],
      certificates: [],
    });
  }

  await deploy(fixture);
  await cleanup(fixture);
  assert.deepEqual([...fixture.remote.certificates.keys()], unrelatedIds);
});
