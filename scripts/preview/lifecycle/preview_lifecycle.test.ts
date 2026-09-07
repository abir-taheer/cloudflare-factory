import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Effect } from "effect";
import {
  PreviewFailure,
  parsePreviewManifest,
  previewResource,
  previewResourcePlan,
} from "../preview_model.ts";
import type { PreviewManifest, PreviewOwner } from "../preview_model.ts";
import {
  type PreviewCloudflare,
  type PreviewCredentials,
  createPreviewCloudflare,
} from "../cloudflare/preview_cloudflare.ts";
import type { PreviewStateStore } from "./preview_state.ts";
import { preparePreviewResource } from "./preview_resource_intent.ts";
import { cleanupPreviewEnvironment } from "./preview_cleanup.ts";
import { renderPreviewWorkerConfig } from "../cloudflare/preview_worker_config.ts";

process.env["RESOURCE_PREFIX"] = "test";

const owner: PreviewOwner = { accountId: "a".repeat(32), repositoryId: "123", pr: 42 };

const credentials: PreviewCredentials = {
  accountId: owner.accountId,
  token: "test",
  stateBucket: "test-control",
  s3Key: "test",
  s3Secret: "test",
  domains: { zoneId: "c".repeat(32), zoneName: "example.test", suffix: "preview.example.test" },
  sandbox: false,
  sandboxImage: undefined,
};

function manifestFixture(): PreviewManifest {
  return {
    version: 2,
    owner,
    head: "b".repeat(40),
    status: "deploying",
    expiresAt: "2099-01-01T00:00:00.000Z",
    database: null,
    sandbox: false,
    resources: previewResourcePlan(owner),
  };
}

function lifecycleFixture(manifest: PreviewManifest) {
  const live = new Map(
    manifest.resources.map((resource) => [resource.name, resource.id ?? resource.name]),
  );

  const failDeletion = new Set<string>();

  const consumers = [
    {
      consumer_id: "e".repeat(32),
      type: "worker",
      script_name: previewResource(manifest, "workflows").name,
    },
  ];

  const objects = new Map([["retained-note", "user content"]]);
  let stored = structuredClone(manifest);

  const state: PreviewStateStore = {
    load: () => Effect.succeed(structuredClone(stored)),
    save: (value) =>
      Effect.sync(() => {
        stored = structuredClone(value);
      }),
    list: () => Effect.succeed([structuredClone(stored)]),
    emptyBucket: () =>
      Effect.sync(() => {
        objects.clear();
      }),
    lock: () => Effect.succeed("lock"),
    unlock: () => Effect.void,
  };

  const cf: PreviewCloudflare = {
    request: (path, method) =>
      Effect.sync(() => {
        if (method === "DELETE" && path.includes("/consumers/")) {
          consumers.length = 0;
        }

        return null;
      }),
    list: (path) => Effect.succeed(path.endsWith("/consumers") ? consumers : []),
    lookupResource: (resource) => Effect.succeed(live.get(resource.name) ?? null),
    create: (resource) =>
      Effect.sync(() => {
        live.set(resource.name, resource.name);
        return resource.name;
      }),
    remove: (resource) => {
      const attachedConsumer = consumers.some((consumer) => consumer.script_name === resource.name);

      if (attachedConsumer) {
        return Effect.fail(new PreviewFailure({ operation: "Worker still consumes queue" }));
      }

      if (failDeletion.has(resource.name)) {
        return Effect.fail(new PreviewFailure({ operation: "Synthetic provider outage" }));
      }

      return Effect.sync(() => {
        live.delete(resource.name);

        if (resource.name === previewResource(manifest, "workflows").name) {
          live.delete(previewResource(manifest, "coordinator").name);
        }
      });
    },
  };

  return { cf, state, live, failDeletion, objects };
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

test("an existing resource is never adopted without a persisted creation intent", async () => {
  const manifest = manifestFixture();
  const fixture = lifecycleFixture(manifest);
  const resource = previewResource(manifest, "objects");

  await assert.rejects(
    Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state)),
  );

  assert.equal(resource.phase, "planned");
  assert.equal(fixture.live.get(resource.name), resource.name);
  resource.phase = "creating";
  await Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state));
  assert.equal(resource.phase, "ready");
  resource.id = "different-resource";

  await assert.rejects(
    Effect.runPromise(preparePreviewResource(manifest, resource, fixture.cf, fixture.state)),
  );
});

test("failed compute deletion retains data and a retry finishes independent cleanup", async () => {
  const manifest = manifestFixture();

  for (const resource of manifest.resources) {
    resource.phase = "ready";
    resource.id = resource.name;
  }

  const fixture = lifecycleFixture(manifest);

  fixture.failDeletion.add(previewResource(manifest, "workflows").name);

  await assert.rejects(
    Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state)),
  );

  assert.equal(manifest.status, "deleting");
  assert.ok(fixture.live.has(previewResource(manifest, "objects").name));
  assert.equal(fixture.objects.get("retained-note"), "user content");
  fixture.failDeletion.clear();

  await Effect.runPromise(
    cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state),
  );

  assert.equal(manifest.status, "deleting");
  assert.equal(fixture.live.size, 1);
  assert.ok(fixture.live.has(previewResource(manifest, "postgres").name));
});

test("cleanup refuses replacement IDs and retains the foreign resource", async () => {
  const manifest = manifestFixture();

  for (const resource of manifest.resources) {
    resource.phase = "ready";
    resource.id = resource.name;
  }

  const fixture = lifecycleFixture(manifest);
  const frontend = previewResource(manifest, "frontend");

  fixture.live.set(frontend.name, "replacement-id");

  await assert.rejects(
    Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state)),
  );

  assert.equal(fixture.live.get(frontend.name), "replacement-id");
});

test("binding contract uses isolated resources, public API, and an assets-only frontend", () => {
  const manifest = manifestFixture();

  for (const resource of manifest.resources) {
    resource.id = resource.name;
  }

  const api = renderPreviewWorkerConfig(manifest, credentials, "api", "/tmp/bundle");
  const worker = renderPreviewWorkerConfig(manifest, credentials, "workflows", "/tmp/bundle");
  const frontend = renderPreviewWorkerConfig(manifest, credentials, "frontend", "/tmp/bundle");

  assert.equal(api["workers_dev"], false);
  assert.equal(worker["workers_dev"], false);
  assert.equal(frontend["workers_dev"], false);
  assert.equal(frontend["services"], undefined);

  assert.deepEqual(api["vars"], {
    ENVIRONMENT: "preview",
    API_URL: `https://${previewResource(manifest, "api").name}.preview.example.test`,
    FRONTEND_ORIGINS: `https://${previewResource(manifest, "frontend").name}.preview.example.test`,
    EMAIL_DELIVERY: "capture",
  });

  assert.equal(JSON.stringify(worker).includes(credentials.stateBucket), false);

  assert.deepEqual(api["hyperdrive"], [
    { binding: "HYPERDRIVE", id: previewResource(manifest, "hyperdrive").id },
  ]);

  assert.equal(api["d1_databases"], undefined);
  assert.equal(worker["containers"], undefined);
});

test("R2 inventory terminates on a full final cursor page without losing resources", async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ name: `bucket-${index}` }));
  const last = Array.from({ length: 100 }, (_, index) => ({ name: `bucket-${index + 100}` }));
  const seen = new Set<string>();

  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const cursor = url.searchParams.get("cursor") ?? "first";

    if (seen.has(cursor)) {
      throw new Error("Repeated cursor");
    }

    seen.add(cursor);

    interface InventoryPage {
      buckets: typeof first;
      cursor?: string;
    }

    let result: InventoryPage = { buckets: last };

    if (cursor === "first") {
      result = { buckets: first, cursor: "last" };
    }

    return Response.json({ success: true, result });
  });

  try {
    const rows = await Effect.runPromise(createPreviewCloudflare(credentials).list("/r2/buckets"));

    assert.equal(rows.length, 200);
    assert.deepEqual(rows.at(-1), { name: "bucket-199" });
  } finally {
    fetchMock.mock.restore();
  }
});

test("untracked domain attachments prevent deletion of an otherwise owned Worker", async () => {
  const manifest = manifestFixture();

  for (const resource of manifest.resources) {
    resource.id = resource.name;
    resource.phase = "ready";
  }

  const fixture = lifecycleFixture(manifest);

  fixture.cf.list = () => Effect.succeed([{ service: previewResource(manifest, "api").name }]);

  await assert.rejects(
    Effect.runPromise(cleanupPreviewEnvironment(manifest, credentials, fixture.cf, fixture.state)),
  );

  assert.ok(fixture.live.has(previewResource(manifest, "api").name));
  assert.ok(fixture.live.has(previewResource(manifest, "objects").name));
});
