import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Effect } from "effect";
import { derivePreviewAuthToken, parsePreviewManifest, previewResourcePlan, previewResource, PreviewFailure } from "./preview-model.ts";
import type { PreviewManifest, PreviewOwner } from "./preview-model.ts";
import { createPreviewCloudflare, type PreviewCloudflare, type PreviewCredentials } from "./preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";
import { preparePreviewResource } from "./preview-deploy.ts";
import { cleanupPreviewEnvironment } from "./preview-cleanup.ts";
import { renderPreviewWorkerConfig } from "./preview-worker-config.ts";

const owner: PreviewOwner = { accountId: "a".repeat(32), repositoryId: "123", pr: 42 };
const credentials: PreviewCredentials = {
  accountId: owner.accountId, token: "test", stateBucket: "test-control", s3Key: "test", s3Secret: "test",
  authSeed: "synthetic-test-seed-32-characters-long", workersSubdomain: "test", sandbox: false,
  sandboxImage: undefined, hyperdrive: false, databaseProvisioner: undefined, databaseProvisionerToken: undefined,
};
function manifestFixture(): PreviewManifest {
  return { version: 1, owner, head: "b".repeat(40), status: "deploying", expiresAt: "2099-01-01T00:00:00.000Z",
    hyperdrive: false, sandbox: false, resources: previewResourcePlan(owner) };
}
function lifecycleFixture(manifest: PreviewManifest) {
  const live = new Map(manifest.resources.map((resource) => [resource.name, resource.id ?? resource.name]));
  const failDeletion = new Set<string>();
  let stored = structuredClone(manifest);
  const state: PreviewStateStore = {
    load: () => Effect.succeed(structuredClone(stored)),
    save: (value) => Effect.sync(() => { stored = structuredClone(value); }),
    list: () => Effect.succeed([structuredClone(stored)]), emptyBucket: () => Effect.void,
    lock: () => Effect.succeed("lock"), unlock: () => Effect.void,
  };
  const cf: PreviewCloudflare = {
    request: () => Effect.succeed(null), list: () => Effect.succeed([]),
    lookupResource: (resource) => Effect.succeed(live.get(resource.name) ?? null),
    create: (resource) => Effect.sync(() => { live.set(resource.name, resource.name); return resource.name; }),
    remove: (resource) => failDeletion.has(resource.name) ? Effect.fail(new PreviewFailure({ operation: "Synthetic provider outage" })) : Effect.sync(() => {
      live.delete(resource.name);
      if (resource.name === previewResource(manifest, "workflows").name) live.delete(previewResource(manifest, "coordinator").name);
    }),
  };
  return { cf, state, live, failDeletion };
}

test("manifest rejects unknown resources, foreign owners and changed deletion names", () => {
  const manifest = manifestFixture();
  assert.deepEqual(parsePreviewManifest(manifest, owner), manifest);
  assert.throws(() => parsePreviewManifest(manifest, { ...owner, pr: 43 }));
  const foreign = structuredClone(manifest);
  previewResource(foreign, "objects").name = "production-objects";
  assert.throws(() => parsePreviewManifest(foreign, owner));
  assert.throws(() => parsePreviewManifest({ ...manifest, resources: [] }, owner));
});

test("per-PR tokens are stable and separated by account, repository and PR", () => {
  const token = derivePreviewAuthToken(credentials.authSeed, owner);
  assert.equal(token, derivePreviewAuthToken(credentials.authSeed, owner));
  for (const other of [{ ...owner, pr: 43 }, { ...owner, repositoryId: "124" }, { ...owner, accountId: "c".repeat(32) }]) {
    assert.notEqual(token, derivePreviewAuthToken(credentials.authSeed, other));
  }
  assert.throws(() => derivePreviewAuthToken("short", owner));
});

test("an existing resource is never adopted without a persisted creation intent", async () => {
  const manifest = manifestFixture();
  const fixture = lifecycleFixture(manifest);
  const resource = previewResource(manifest, "objects");
  await assert.rejects(Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state)));
  assert.equal(resource.phase, "planned");
  assert.equal(fixture.live.get(resource.name), resource.name);
  resource.phase = "creating";
  await Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state));
  assert.equal(resource.phase, "ready");
  resource.id = "different-resource";
  await assert.rejects(Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state)));
});

test("failed compute deletion retains data and a retry finishes independent cleanup", async () => {
  const manifest = manifestFixture();
  for (const resource of manifest.resources) { resource.phase = "ready"; resource.id = resource.name; }
  const fixture = lifecycleFixture(manifest);
  fixture.failDeletion.add(previewResource(manifest, "workflows").name);
  await assert.rejects(Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state)));
  assert.equal(manifest.status, "deleting");
  assert.ok(fixture.live.has(previewResource(manifest, "objects").name));
  fixture.failDeletion.clear();
  await Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state));
  assert.equal(manifest.status, "deleted");
  assert.equal(fixture.live.size, 0);
});

test("cleanup refuses replacement IDs and retains the foreign resource", async () => {
  const manifest = manifestFixture();
  for (const resource of manifest.resources) { resource.phase = "ready"; resource.id = resource.name; }
  const fixture = lifecycleFixture(manifest);
  const frontend = previewResource(manifest, "frontend");
  fixture.live.set(frontend.name, "replacement-id");
  await assert.rejects(Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state)));
  assert.equal(fixture.live.get(frontend.name), "replacement-id");
});

test("binding contract uses only PR resources and keeps API and workflow ingress private", () => {
  const manifest = manifestFixture();
  for (const resource of manifest.resources) resource.id = resource.name;
  const api = renderPreviewWorkerConfig(manifest, credentials, "api", "/tmp/bundle");
  const worker = renderPreviewWorkerConfig(manifest, credentials, "workflows", "/tmp/bundle");
  const frontend = renderPreviewWorkerConfig(manifest, credentials, "frontend", "/tmp/bundle");
  assert.equal(api["workers_dev"], false);
  assert.equal(worker["workers_dev"], false);
  assert.equal(frontend["workers_dev"], true);
  assert.equal(JSON.stringify(api).includes(credentials.authSeed), false);
  assert.equal(JSON.stringify(worker).includes(credentials.stateBucket), false);
  assert.equal(api["hyperdrive"], undefined);
  assert.equal(worker["containers"], undefined);
});

test("R2 inventory terminates on a full final cursor page without losing resources", async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ name: `bucket-${index}` }));
  const last = Array.from({ length: 100 }, (_, index) => ({ name: `bucket-${index + 100}` }));
  const seen = new Set<string>();
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const cursor = url.searchParams.get("cursor") ?? "first";
    if (seen.has(cursor)) throw new Error("Repeated cursor");
    seen.add(cursor);
    return Response.json({ success: true, result: cursor === "first" ? { buckets: first, cursor: "last" } : { buckets: last } });
  });
  try {
    const rows = await Effect.runPromise(createPreviewCloudflare(credentials).list("/r2/buckets"));
    assert.equal(rows.length, 200);
    assert.deepEqual(rows.at(-1), { name: "bucket-199" });
  } finally { fetchMock.mock.restore(); }
});
