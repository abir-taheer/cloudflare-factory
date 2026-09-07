import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { ConfigProvider, Effect } from "effect";
import {
  parseProductionInventory,
  productionApps,
  productionPrefix,
  renderProductionWorkerConfig,
} from "./production-model.ts";
import { validateProductionArtifacts } from "../build/production-artifacts.ts";
import { productionDispatch } from "./production-context.ts";

const randomHex = (size: number) =>
  Array.from(randomBytes(size), (byte) => byte.toString(16).padStart(2, "0")).join("");

const prefix = productionPrefix(`r-${randomUUID().slice(0, 24)}`);

const inventory = () => ({
  cache: { name: `${prefix}-cache`, id: randomUUID() },
  objects: { name: `${prefix}-objects`, id: `${prefix}-objects` },
  jobs: { name: `${prefix}-jobs`, id: randomUUID() },
});

test("production dispatch rejects branch, environment and app substitution before credentials", () => {
  const environment = {
    GITHUB_ACTIONS: "true",
    DEPLOYMENT_ENVIRONMENT: "cloudflare-prod",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    REPOSITORY: `org-${randomUUID()}/repo`,
    REPOSITORY_ID: String(randomInt(1, 1_000_000)),
    REVISION: randomHex(20),
    DEPLOYMENT_APP: "api",
    ALLOW_CREATE: "false",
    CLOUDFLARE_ACCOUNT_ID: randomHex(16),
    CLOUDFLARE_ACCOUNT_NAME: randomUUID(),
    CLOUDFLARE_ZONE_ID: randomHex(16),
    CLOUDFLARE_ZONE_NAME: "example.test",
    DOMAIN_SUFFIX: "prod.example.test",
    API_URL: "https://api.prod.example.test",
    FRONTEND_URL: "https://app.prod.example.test",
  };

  assert.equal(
    Effect.runSync(productionDispatch.parse(ConfigProvider.fromEnvRecord(environment)))
      .DEPLOYMENT_APP,
    "api",
  );

  for (const replacement of [
    { GITHUB_REF: "refs/heads/untrusted" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { DEPLOYMENT_ENVIRONMENT: "cloudflare-preview" },
    { DEPLOYMENT_APP: "executor" },
    { ALLOW_CREATE: "" },
  ]) {
    assert.throws(() =>
      Effect.runSync(
        productionDispatch.parse(ConfigProvider.fromEnvRecord({ ...environment, ...replacement })),
      ),
    );
  }
});

test("production inventory refuses foreign resource names and undeclared resources", () => {
  const resources = inventory();

  assert.deepEqual(parseProductionInventory(resources, prefix), resources);

  assert.throws(() =>
    parseProductionInventory(
      { ...resources, cache: { ...resources.cache, name: randomUUID() } },
      prefix,
    ),
  );

  assert.throws(() =>
    parseProductionInventory({ ...resources, unexpected: resources.cache }, prefix),
  );

  assert.throws(() =>
    parseProductionInventory(
      { ...resources, objects: { ...resources.objects, id: randomUUID() } },
      prefix,
    ),
  );
});

test("selected Worker configs use only registered PostgreSQL resources and custom-domain-only ingress", () => {
  const resources = parseProductionInventory(inventory(), prefix);

  const owner = {
    accountId: randomHex(16),
    repositoryId: String(randomInt(1, 1_000_000)),
    prefix,
    sha: randomHex(20),
  };

  const hyperdriveId = randomUUID();

  assert.deepEqual(productionApps("api"), ["api"]);
  assert.deepEqual(productionApps("all"), ["workflows", "api", "frontend"]);

  for (const app of productionApps("all")) {
    const config = renderProductionWorkerConfig(
      owner,
      resources,
      app,
      "/tmp/artifacts",
      hyperdriveId,
      { EMAIL_FROM: "auth@example.test", EMAIL_DELIVERY: "cloudflare" },
    );

    assert.partialDeepStrictEqual(config, {
      workers_dev: false,
      preview_urls: false,
      no_bundle: true,
    });

    assert.equal("d1_databases" in config, false);
    assert.equal("containers" in config, false);
    assert.equal("build" in config, false);
    assert.equal("BETTER_AUTH_SECRET" in config, false);

    if (app === "api") {
      assert.deepEqual(config["send_email"], [
        { name: "EMAIL", allowed_sender_addresses: ["auth@example.test"] },
      ]);

      assert.partialDeepStrictEqual(config["vars"], {
        EMAIL_DELIVERY: "cloudflare",
        EMAIL_FROM: "auth@example.test",
      });
    } else {
      assert.equal("send_email" in config, false);
    }

    if (app === "frontend") {
      assert.equal("services" in config, false);
    }

    if (app !== "frontend") {
      assert.deepEqual(config["hyperdrive"], [{ binding: "HYPERDRIVE", id: hyperdriveId }]);
    }
  }
});

test("artifact boundary rejects wrong revisions, extra files, missing bundles and symlinks", async () => {
  const directory = await mkdtemp("/tmp/production-artifacts-test-");

  const revision = {
    app: "api",
    sha: randomHex(20),
    repositoryId: String(randomInt(1, 1_000_000)),
  } satisfies Parameters<typeof validateProductionArtifacts>[1];

  const validate = () => Effect.runPromise(validateProductionArtifacts(directory, revision));

  try {
    await writeFile(nodePath.join(directory, "provenance.json"), JSON.stringify(revision));
    await assert.rejects(validate());
    await writeFile(nodePath.join(directory, "api.mjs"), "export {};");
    await validate();

    await assert.rejects(
      Effect.runPromise(
        validateProductionArtifacts(directory, { ...revision, sha: randomHex(20) }),
      ),
    );

    await writeFile(nodePath.join(directory, "unexpected.json"), "{}");
    await assert.rejects(validate());
    await rm(nodePath.join(directory, "unexpected.json"));
    await rm(nodePath.join(directory, "api.mjs"));
    await symlink("/etc/passwd", nodePath.join(directory, "api.mjs"));
    await assert.rejects(validate());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
