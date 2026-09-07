import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { ConfigProvider, Effect } from "effect";
import { productionDispatch, verifyProductionRevision } from "./production_context.ts";

const randomHex = (size: number) =>
  Array.from(randomBytes(size), (byte) => byte.toString(16).padStart(2, "0")).join("");

const productionEnvironment = () => ({
  GITHUB_ACTIONS: "true",
  DEPLOYMENT_ENVIRONMENT: "cloudflare-prod",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  DEFAULT_BRANCH: "main",
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
});

test("production dispatch rejects branch, environment and app substitution before credentials", () => {
  const environment = productionEnvironment();

  assert.equal(
    Effect.runSync(productionDispatch.parse(ConfigProvider.fromEnvRecord(environment)))
      .DEPLOYMENT_APP,
    "api",
  );

  for (const replacement of [
    { GITHUB_REF: "refs/heads/untrusted" },
    { GITHUB_REF: "refs/tags/main" },
    { DEFAULT_BRANCH: "master" },
    { DEFAULT_BRANCH: "" },
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { DEPLOYMENT_ENVIRONMENT: "cloudflare-preview" },
    { DEPLOYMENT_APP: "unsupported-app" },
    { ALLOW_CREATE: "" },
  ]) {
    assert.throws(() =>
      Effect.runSync(
        productionDispatch.parse(ConfigProvider.fromEnvRecord({ ...environment, ...replacement })),
      ),
    );
  }

  const { DEFAULT_BRANCH: _defaultBranch, ...missingDefaultBranch } = environment;

  assert.throws(() =>
    Effect.runSync(productionDispatch.parse(ConfigProvider.fromEnvRecord(missingDefaultBranch))),
  );
});

test("production default-branch releases preserve manual selection and deny push creation or selection", () => {
  for (const branch of ["main", "master", "releases/production"]) {
    const environment = {
      ...productionEnvironment(),
      DEFAULT_BRANCH: branch,
      GITHUB_REF: `refs/heads/${branch}`,
    };

    const parse = (replacement: Partial<typeof environment>) =>
      Effect.runSync(
        productionDispatch.parse(ConfigProvider.fromEnvRecord({ ...environment, ...replacement })),
      );

    for (const app of ["api", "frontend", "workflows", "all"]) {
      for (const allowCreate of ["true", "false"]) {
        assert.partialDeepStrictEqual(parse({ DEPLOYMENT_APP: app, ALLOW_CREATE: allowCreate }), {
          DEPLOYMENT_APP: app,
          ALLOW_CREATE: allowCreate,
          DEFAULT_BRANCH: branch,
        });

        const push = {
          GITHUB_EVENT_NAME: "push",
          DEPLOYMENT_APP: app,
          ALLOW_CREATE: allowCreate,
        };

        if (app === "all" && allowCreate === "false") {
          assert.partialDeepStrictEqual(parse(push), push);
        } else {
          assert.throws(() => parse(push));
        }
      }
    }

    for (const replacement of [
      { GITHUB_EVENT_NAME: "push", DEPLOYMENT_APP: "all", ALLOW_CREATE: "" },
      { GITHUB_EVENT_NAME: "push", DEPLOYMENT_APP: "", ALLOW_CREATE: "false" },
      { GITHUB_EVENT_NAME: "push", DEPLOYMENT_APP: "all", GITHUB_REF: "refs/heads/feature" },
    ]) {
      assert.throws(() => parse(replacement));
    }
  }
});

test("production revision verification rejects foreign metadata, unavailable heads and moved default branches", async (context) => {
  const previousToken = process.env["GH_TOKEN"];

  process.env["GH_TOKEN"] = "synthetic-github-token";

  context.after(() => {
    if (previousToken === undefined) {
      delete process.env["GH_TOKEN"];
    } else {
      process.env["GH_TOKEN"] = previousToken;
    }
  });

  const environment = productionEnvironment();

  const repository = {
    id: Number(environment.REPOSITORY_ID),
    full_name: environment.REPOSITORY,
    default_branch: "main",
  };

  const remote = {
    repository: { ...repository },
    head: { sha: environment.REVISION },
    status: 200,
  };

  context.mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = new URL(new Request(input).url);

    if (url.origin !== "https://api.github.com") {
      throw new Error("Production test forbids non-GitHub requests");
    }

    if (url.pathname === `/repos/${environment.REPOSITORY}`) {
      return Promise.resolve(Response.json(remote.repository, { status: remote.status }));
    }

    if (
      url.pathname ===
      `/repos/${environment.REPOSITORY}/commits/${encodeURIComponent(remote.repository.default_branch)}`
    ) {
      return Promise.resolve(Response.json(remote.head, { status: remote.status }));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });

  for (const branch of ["main", "master", "releases/production"]) {
    remote.repository = { ...repository, default_branch: branch };

    const dispatch = Effect.runSync(
      productionDispatch.parse(
        ConfigProvider.fromEnvRecord({
          ...environment,
          DEFAULT_BRANCH: branch,
          GITHUB_REF: `refs/heads/${branch}`,
        }),
      ),
    );

    const verify = () => Effect.runPromise(verifyProductionRevision(dispatch));
    await verify();

    for (const replacement of [
      { id: repository.id + 1 },
      { full_name: "foreign/repository" },
      { default_branch: branch === "main" ? "master" : "main" },
      { default_branch: "" },
    ]) {
      remote.repository = { ...repository, default_branch: branch, ...replacement };
      await assert.rejects(verify());
    }

    remote.repository = { ...repository, default_branch: branch };

    for (const sha of [randomHex(20), "", "invalid-revision"]) {
      remote.head.sha = sha;
      await assert.rejects(verify());
    }

    remote.head.sha = environment.REVISION;

    for (const status of [403, 404, 503]) {
      remote.status = status;
      await assert.rejects(verify());
    }

    remote.status = 200;

    await assert.rejects(
      Effect.runPromise(
        verifyProductionRevision({ ...dispatch, GITHUB_REF: "refs/heads/foreign" }),
      ),
    );

    await verify();
  }
});
