import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewString } from "./preview-model.ts";

/** GitHub API reads bind preview operations to the real repository, PR and current head. */
export const previewGithubRequest = (path: string) => previewIo("Preview GitHub verification failed", async () => {
  const token = previewString(process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"]);
  if (!path.startsWith("/repos/") || path.includes("..")) throw new Error("GitHub path rejected");
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  if (!response.ok) throw new Error("GitHub request failed");
  return previewRecord(await response.json());
});

/** Fail closed on fork heads, deleted heads and repository renames not confirmed by GitHub. */
export const readPreviewPullRequest = (repository: string, pr: number) => Effect.gen(function* () {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !Number.isSafeInteger(pr) || pr < 1) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview GitHub target invalid" }));
  }
  const pull = yield* previewGithubRequest(`/repos/${repository}/pulls/${pr}`);
  const baseRepository = previewRecord(previewRecord(pull["base"])["repo"]);
  const head = previewRecord(pull["head"]);
  const headRepository = previewRecord(head["repo"]);
  if (baseRepository["full_name"] !== repository || headRepository["id"] !== baseRepository["id"]) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview fork deployment forbidden" }));
  }
  const sha = previewString(head["sha"]);
  if (!/^[a-f0-9]{40}$/u.test(sha) || typeof baseRepository["id"] !== "number") {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview GitHub identity invalid" }));
  }
  return { head: sha, state: pull["state"], repositoryId: String(baseRepository["id"]) };
});

/** workflow_run inputs come from GitHub, never artifact-provided PR numbers or metadata. */
export const resolvePreviewRun = (repository: string, runId: string, operation: "deploy" | "destroy") => Effect.gen(function* () {
  if (!/^\d+$/u.test(runId)) return yield* Effect.fail(new PreviewFailure({ operation: "Preview run ID invalid" }));
  const run = yield* previewGithubRequest(`/repos/${repository}/actions/runs/${runId}`);
  const expectedPath = operation === "deploy" ? ".github/workflows/preview-build.yml" : ".github/workflows/preview-cleanup-request.yml";
  if (run["event"] !== "pull_request" || run["path"] !== expectedPath || run["conclusion"] !== "success" ||
    previewRecord(run["head_repository"])["full_name"] !== repository) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview build provenance rejected" }));
  }
  const pulls = run["pull_requests"];
  if (!Array.isArray(pulls) || pulls.length !== 1) return yield* Effect.fail(new PreviewFailure({ operation: "Preview run has no unique PR; reconcile or dispatch explicitly" }));
  const pr = previewRecord(pulls[0])["number"];
  if (typeof pr !== "number") return yield* Effect.fail(new PreviewFailure({ operation: "Preview run PR invalid" }));
  const pull = yield* readPreviewPullRequest(repository, pr);
  if (operation === "deploy" && (pull.state !== "open" || pull.head !== run["head_sha"])) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview build is stale or PR closed" }));
  }
  if (operation === "destroy" && pull.state !== "closed") return yield* Effect.fail(new PreviewFailure({ operation: "Preview PR reopened; cleanup skipped" }));
  return { ...pull, pr };
});
