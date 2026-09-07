import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Effect } from "effect";
import { previewDomainFixture } from "./preview_domain_fixture.ts";
import { deployPreviewDomains } from "./preview_domain_deploy.ts";
import { cleanupPreviewDomains } from "./preview_domain_cleanup.ts";

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

test("generated certificates recover interrupted attachment and clean up after leaf issuance", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.generatedCertificate = true;
  fixture.remote.failure = "attach-response";
  await assert.rejects(deploy(fixture));

  const stored = await Effect.runPromise(fixture.state.load(fixture.manifest.owner));

  assert.ok(stored);
  fixture.manifest = stored;
  await deploy(fixture);
  assert.equal(fixture.remote.domains.size, 2);

  for (const pack of fixture.remote.certificates.values()) {
    pack.certificates.push({ id: randomUUID(), hosts: pack.hosts.toReversed() });
  }

  await deploy(fixture);
  await cleanup(fixture);
  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.certificates.size, 0);
});

test("generated certificate cleanup preserves an apex used outside the preview", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.generatedCertificate = true;
  await deploy(fixture);

  const apex = { id: randomUUID(), name: fixture.credentials.domains.zoneName };

  fixture.remote.dns.set(apex.name, apex);
  await assert.rejects(cleanup(fixture));
  assert.equal(fixture.remote.domains.size, 0);
  assert.equal(fixture.remote.certificates.size, 2);
  assert.deepEqual(fixture.remote.dns.get(apex.name), apex);
});

test("generated certificate rejects unrelated leaf coverage before deletion", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.generatedCertificate = true;
  await deploy(fixture);

  const pack = [...fixture.remote.certificates.values()][0];

  assert.ok(pack);
  pack.certificates.push({ id: randomUUID(), hosts: ["*.example.test"] });
  await assert.rejects(cleanup(fixture));
  assert.deepEqual(fixture.remote.certificates.get(pack.id), pack);
});

test("generated certificate cleanup retains coverage for a non-Worker child origin", async (context) => {
  const fixture = previewDomainFixture(context);

  fixture.remote.generatedCertificate = true;
  await deploy(fixture);

  const domain = fixture.manifest.domains?.[0];

  assert.ok(domain);

  const child = { id: randomUUID(), name: `child.${domain.hostname}` };

  fixture.remote.dns.set(child.name, child);
  await assert.rejects(cleanup(fixture));
  assert.equal(fixture.remote.certificates.size, 2);
  assert.deepEqual(fixture.remote.dns.get(child.name), child);
});
