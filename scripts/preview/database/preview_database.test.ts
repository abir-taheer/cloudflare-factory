import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import {
  parseDatabaseHandoff,
  readDatabaseHandoff,
  writeDatabaseHandoff,
} from "../../shared/database/database_contract.ts";
import type { DatabaseHandoff, DatabaseIdentity } from "../../shared/database/database_schema.ts";
import {
  createNeonDatabaseAdapter,
  createNeonDatabaseIdentity,
  validateNeonOwnedBranch,
} from "../../shared/database/neon_adapter.ts";
import type { NeonDatabaseApi, NeonDatabaseCredentials } from "../../shared/database/neon_api.ts";
import { cleanupPreviewDatabase } from "./preview_database_lifecycle.ts";
import { previewResourcePlan } from "../preview_model.ts";
import type { PreviewManifest } from "../preview_model.ts";

process.env["RESOURCE_PREFIX"] = "test";

const credentials: NeonDatabaseCredentials = {
  apiKey: "synthetic",
  projectId: "test-project",
  parentBranchId: "br-empty",
  databaseName: "testdb",
  roleName: "testrole",
};

const owner = {
  accountId: "a".repeat(32),
  repositoryId: "123",
  environment: "preview",
  pr: 42,
} as const;

function databaseFixture() {
  const identity = createNeonDatabaseIdentity(credentials);
  const target = { owner, name: "test-postgres", identity };

  const annotations = {
    account: owner.accountId,
    repository: owner.repositoryId,
    environment: owner.environment,
    pr: String(owner.pr),
    intent: identity.intentId,
    parent: identity.parentBranchId,
  };

  const details = {
    branch: {
      id: "br-owned",
      project_id: identity.projectId,
      name: target.name,
      default: false,
      protected: false,
      init_source: "parent-schema",
      current_state: "ready",
    },
    annotation: { value: annotations },
  };

  let live = true;

  const api: NeonDatabaseApi = {
    branchByName: () => Effect.succeed(live ? details : null),
    request: (path, method) =>
      Effect.sync(() => {
        if (method === "DELETE") {
          live = false;
          return {};
        }

        if (path.includes("/reset_password")) {
          return { role: { name: "testrole" } };
        }

        if (path.startsWith("/connection_uri?")) {
          return {
            uri: "postgresql://testrole:synthetic-password@ep-owned.example.neon.tech/testdb?sslmode=require",
          };
        }

        if (path.endsWith("/endpoints")) {
          return {
            endpoints: [
              {
                id: "ep-owned",
                host: "ep-owned.example.neon.tech",
                branch_id: "br-owned",
                project_id: identity.projectId,
                type: "read_write",
              },
            ],
          };
        }

        return live ? details : null;
      }),
  };

  return { target, details, api, isLive: () => live };
}

test("uncertain branch creation recovers only its persisted intent and writes no credentials to state", async () => {
  const fixture = databaseFixture();
  const persisted: DatabaseIdentity[] = [];

  const handoff = await Effect.runPromise(
    createNeonDatabaseAdapter(credentials, fixture.api).provision(fixture.target, (identity) =>
      Effect.sync(() => {
        persisted.push(identity);
      }),
    ),
  );

  assert.partialDeepStrictEqual(handoff.identity, {
    branchId: "br-owned",
    parentBranchId: "br-empty",
    endpointId: "ep-owned",
  });

  assert.ok(persisted.length > 0);
  assert.equal(JSON.stringify(persisted).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(persisted).includes("postgresql:"), false);
});

test("matching names with foreign nonce, parent, owner or branch ID are never adopted or deleted", async () => {
  const fixture = databaseFixture();

  for (const changed of [
    { ...fixture.target, identity: { ...fixture.target.identity, intentId: "foreign" } },
    { ...fixture.target, identity: { ...fixture.target.identity, parentBranchId: "br-other" } },
    { ...fixture.target, identity: { ...fixture.target.identity, branchId: "br-replacement" } },
    { ...fixture.target, owner: { ...owner, repositoryId: "456" } },
  ]) {
    assert.throws(() => validateNeonOwnedBranch(fixture.details, changed, credentials));

    await assert.rejects(
      Effect.runPromise(createNeonDatabaseAdapter(credentials, fixture.api).remove(changed)),
    );

    assert.equal(fixture.isLive(), true);
  }
});

test("schema-only roots require the original source annotation and reject attached data branches", () => {
  const fixture = databaseFixture();

  for (const details of [
    {
      ...fixture.details,
      annotation: { value: { ...fixture.details.annotation.value, parent: "br-foreign" } },
    },
    {
      ...fixture.details,
      branch: { ...fixture.details.branch, parent_id: credentials.parentBranchId },
    },
    { ...fixture.details, branch: { ...fixture.details.branch, init_source: "parent-data" } },
  ]) {
    assert.throws(() => validateNeonOwnedBranch(details, fixture.target, credentials));
  }
});

test("missing known branch and replacement endpoint fail closed rather than recreating or rebinding", async () => {
  const fixture = databaseFixture();

  const known = {
    ...fixture.target,
    identity: {
      ...fixture.target.identity,
      branchId: "br-owned",
      endpointId: "ep-old",
      hostname: "old.example.neon.tech",
    },
  };

  const adapter = createNeonDatabaseAdapter(credentials, fixture.api);
  await assert.rejects(Effect.runPromise(adapter.provision(known, () => Effect.void)));

  const missing = createNeonDatabaseAdapter(credentials, {
    ...fixture.api,
    branchByName: () => Effect.succeed(null),
  });

  await assert.rejects(Effect.runPromise(missing.provision(known, () => Effect.void)));
});

test("database handoff rejects pooled connections, owner changes and world-readable files", async () => {
  const fixture = databaseFixture();

  const handoff = await Effect.runPromise(
    createNeonDatabaseAdapter(credentials, fixture.api).provision(
      fixture.target,
      () => Effect.void,
    ),
  );

  assert.deepEqual(parseDatabaseHandoff(handoff, handoff), handoff);

  for (const invalid of [
    { ...handoff, unexpected: "not-allowed" },
    { ...handoff, owner: { ...handoff.owner, unexpected: "not-allowed" } },
    { ...handoff, identity: { ...handoff.identity, unexpected: "not-allowed" } },
    { ...handoff, owner: { ...handoff.owner, pr: 1.5 } },
  ]) {
    assert.throws(() => parseDatabaseHandoff(invalid, handoff), /Database handoff schema invalid/u);
  }

  assert.throws(() =>
    parseDatabaseHandoff(
      { ...handoff, directUrl: handoff.directUrl.replace("ep-owned", "ep-owned-pooler") },
      handoff,
    ),
  );

  assert.throws(() =>
    parseDatabaseHandoff({ ...handoff, owner: { ...handoff.owner, pr: 43 } }, handoff),
  );

  assert.throws(() =>
    parseDatabaseHandoff(
      { ...handoff, directUrl: handoff.directUrl.replace("sslmode=require", "sslmode=disable") },
      handoff,
    ),
  );

  const directory = await mkdtemp("/tmp/database-handoff-test-");
  const path = `${directory}/handoff.json`;

  try {
    await Effect.runPromise(writeDatabaseHandoff(path, handoff));

    const loaded = await Effect.runPromise(readDatabaseHandoff(path, handoff));

    assert.deepEqual(loaded, handoff);
    await chmod(path, 0o644);
    await assert.rejects(Effect.runPromise(readDatabaseHandoff(path, handoff)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database cleanup retains a branch while compute exists and verifies absence before tombstoning", async () => {
  const fixture = databaseFixture();

  const handoff: DatabaseHandoff = await Effect.runPromise(
    createNeonDatabaseAdapter(credentials, fixture.api).provision(
      fixture.target,
      () => Effect.void,
    ),
  );

  const manifest: PreviewManifest = {
    version: 2,
    owner,
    database: handoff.identity,
    head: "a".repeat(40),
    sandbox: false,
    status: "deleting",
    expiresAt: "2099-01-01T00:00:00Z",
    resources: previewResourcePlan(owner),
  };

  const database = manifest.resources.find((resource) => resource.kind === "database");

  assert.ok(database);
  fixture.details.branch.name = database.name;

  const state = {
    save: () => Effect.void,
    load: () => Effect.succeed(manifest),
    list: () => Effect.succeed([manifest]),
    emptyBucket: () => Effect.void,
    lock: () => Effect.succeed("test"),
    unlock: () => Effect.void,
  };

  const adapter = createNeonDatabaseAdapter(credentials, fixture.api);

  await assert.rejects(Effect.runPromise(cleanupPreviewDatabase(manifest, adapter, state)));
  assert.equal(fixture.isLive(), true);

  for (const resource of manifest.resources) {
    resource.phase = resource.kind === "database" ? "ready" : "deleted";
  }

  await Effect.runPromise(cleanupPreviewDatabase(manifest, adapter, state));
  assert.equal(manifest.status, "deleted");
  assert.equal(fixture.isLive(), false);
});
