import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { ConfigProvider, Effect } from "effect";
import { previewStatusConfiguration, publishPreviewStatus } from "./preview_status.ts";

process.env["GH_TOKEN"] = "fixture-token";

function statusFixture(context: TestContext) {
  const repository = "fixture/product";
  const head = "a".repeat(40);
  const statuses = new Map<string, unknown>();

  const remote = {
    head,
    state: "open",
    source: ".github/workflows/preview_build.yml",
    repositoryId: 17,
    defaultBranch: "master",
    rejectStatus: false,
  };

  const configuration = Effect.runSync(
    previewStatusConfiguration.parse(
      ConfigProvider.fromEnvRecord({
        GITHUB_EVENT_NAME: "workflow_run",
        GITHUB_REF: "refs/heads/master",
        GITHUB_REPOSITORY: repository,
        GITHUB_RUN_ID: "24",
        GITHUB_TOKEN: "fixture-token",
        RUN_ID: "23",
      }),
    ),
  );

  context.mock.method(globalThis, "fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);

    assert.equal(url.origin, "https://api.github.com");

    if (init?.method === "POST") {
      assert.equal(url.pathname, `/repos/${repository}/statuses/${head}`);

      if (remote.rejectStatus) {
        return Promise.resolve(new Response(null, { status: 403 }));
      }

      assert.ok(typeof init.body === "string");
      statuses.set(url.pathname, JSON.parse(init.body));
      return Promise.resolve(Response.json({}));
    }

    if (url.pathname === `/repos/${repository}/actions/runs/23`) {
      return Promise.resolve(
        Response.json({
          event: "pull_request",
          path: remote.source,
          conclusion: "success",
          head_repository: { full_name: repository },
          head_sha: head,
          pull_requests: [{ number: 4 }],
        }),
      );
    }

    if (url.pathname === `/repos/${repository}/pulls/4`) {
      return Promise.resolve(
        Response.json({
          state: remote.state,
          base: { repo: { id: 17, full_name: repository } },
          head: { sha: remote.head, repo: { id: remote.repositoryId } },
        }),
      );
    }

    if (url.pathname === `/repos/${repository}`) {
      return Promise.resolve(Response.json({ default_branch: remote.defaultBranch }));
    }

    throw new Error("Unexpected GitHub route");
  });

  return { configuration, remote, statuses, head, repository };
}

test("current PR revision receives a pending gate followed by its verified result", async (context) => {
  const fixture = statusFixture(context);
  const statusPath = `/repos/${fixture.repository}/statuses/${fixture.head}`;

  await Effect.runPromise(publishPreviewStatus(fixture.configuration, "pending"));
  assert.partialDeepStrictEqual(fixture.statuses.get(statusPath), { state: "pending" });
  await Effect.runPromise(publishPreviewStatus(fixture.configuration, "success"));

  assert.partialDeepStrictEqual(fixture.statuses.get(statusPath), {
    state: "success",
    context: "Preview verified",
  });
});

test("stale, closed, forked and wrong-workflow builds never receive a success gate", async (context) => {
  const fixture = statusFixture(context);

  for (const replacement of [
    { head: "b".repeat(40) },
    { state: "closed" },
    { repositoryId: 99 },
    { source: ".github/workflows/untrusted.yml" },
    { defaultBranch: "main" },
  ]) {
    const original = { ...fixture.remote };
    Object.assign(fixture.remote, replacement);

    await assert.rejects(Effect.runPromise(publishPreviewStatus(fixture.configuration, "success")));
    assert.equal(fixture.statuses.size, 0);
    Object.assign(fixture.remote, original);
  }
});

test("failed deployment publishes failure and denied status writes fail the controller", async (context) => {
  const fixture = statusFixture(context);
  const statusPath = `/repos/${fixture.repository}/statuses/${fixture.head}`;

  await Effect.runPromise(publishPreviewStatus(fixture.configuration, "failure"));
  assert.partialDeepStrictEqual(fixture.statuses.get(statusPath), { state: "failure" });
  fixture.remote.rejectStatus = true;
  await assert.rejects(Effect.runPromise(publishPreviewStatus(fixture.configuration, "success")));
  assert.partialDeepStrictEqual(fixture.statuses.get(statusPath), { state: "failure" });
});
