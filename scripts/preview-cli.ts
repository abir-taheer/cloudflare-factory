import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewString, derivePreviewAuthToken, previewResource } from "./preview-model.ts";
import { createPreviewCloudflare, loadPreviewCredentials, verifyPreviewAccount } from "./preview-cloudflare.ts";
import { createPreviewStateStore } from "./preview-state.ts";
import { verifyPreviewDeployment } from "./preview-verify.ts";
import { deployPreviewEnvironment } from "./preview-deploy.ts";
import { cleanupPreviewEnvironment } from "./preview-cleanup.ts";
import { reconcilePreviewEnvironments } from "./preview-reconcile.ts";
import { previewGithubRequest, readPreviewPullRequest, resolvePreviewRun } from "./preview-github.ts";

function parsePreviewArguments(args: string[]) {
  const operation = args[0];
  if (operation !== "deploy" && operation !== "destroy" && operation !== "reconcile" && operation !== "verify" && operation !== "token") {
    throw new PreviewFailure({ operation: "Preview usage: deploy|destroy|reconcile|verify|token [--local] [--pr NUMBER] [--artifacts PATH]" });
  }
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (flag === undefined || !["--local", "--pr", "--artifacts"].includes(flag) || flags.has(flag)) {
      throw new PreviewFailure({ operation: "Preview CLI flag invalid" });
    }
    if (flag === "--local") flags.set(flag, "true");
    else {
      const value = args[index += 1];
      if (value === undefined || value.startsWith("--")) throw new PreviewFailure({ operation: "Preview CLI value missing" });
      flags.set(flag, value);
    }
  }
  const local = flags.has("--local");
  return { operation, flags, local };
}

/** Explicit local mode requires Docker, Doppler scope checks and the same account readback as CI. */
export const runPreviewCommand = (args: string[]) => Effect.gen(function* () {
  const { operation, flags, local } = parsePreviewArguments(args);
  const repository = previewString(local ? process.env["PREVIEW_REPOSITORY"] : process.env["GITHUB_REPOSITORY"]);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) return yield* Effect.fail(new PreviewFailure({ operation: "Preview repository invalid" }));
  const metadata = yield* previewGithubRequest(`/repos/${repository}`);
  if (typeof metadata["id"] !== "number" || metadata["full_name"] !== repository) return yield* Effect.fail(new PreviewFailure({ operation: "Preview repository identity mismatch" }));
  const runId = process.env["PREVIEW_RUN_ID"];
  let target: { head: string; state: unknown; repositoryId: string; pr: number } | null = null;
  if (operation !== "reconcile") {
    target = !local && runId !== undefined && runId !== ""
      ? yield* resolvePreviewRun(repository, runId, operation === "deploy" ? "deploy" : "destroy")
      : { ...(yield* readPreviewPullRequest(repository, Number(flags.get("--pr")))), pr: Number(flags.get("--pr")) };
  }
  if (target && target.repositoryId !== String(metadata["id"])) return yield* Effect.fail(new PreviewFailure({ operation: "Preview repository changed" }));
  const credentials = yield* loadPreviewCredentials(local);
  yield* verifyPreviewAccount(credentials);
  const cf = createPreviewCloudflare(credentials);
  const subdomain = previewRecord(yield* cf.request("/workers/subdomain"));
  if (subdomain["subdomain"] !== credentials.workersSubdomain) return yield* Effect.fail(new PreviewFailure({ operation: "Preview Workers subdomain mismatch" }));
  const owner = { accountId: credentials.accountId, repositoryId: String(metadata["id"]), pr: target?.pr ?? 1 };
  const state = createPreviewStateStore(credentials);
  if (operation === "token" || operation === "verify") {
    if (!local) return yield* Effect.fail(new PreviewFailure({ operation: "Preview access commands require explicit local mode" }));
    const manifest = yield* state.load(owner);
    if (manifest?.status !== "ready" || Date.parse(manifest.expiresAt) <= Date.now()) return yield* Effect.fail(new PreviewFailure({ operation: "Preview access requires a ready unexpired manifest" }));
    const token = derivePreviewAuthToken(credentials.authSeed, owner);
    if (operation === "token") process.stdout.write(`${token}\n`);
    else yield* verifyPreviewDeployment(`https://${previewResource(manifest, "frontend").name}.${credentials.workersSubdomain}.workers.dev`, token);
    return yield* Effect.void;
  }
  yield* Effect.acquireUseRelease(state.lock(owner), () => Effect.gen(function* () {
    if (operation === "reconcile") return yield* reconcilePreviewEnvironments(repository, owner, credentials, cf, state);
    if (!target) return yield* Effect.fail(new PreviewFailure({ operation: "Preview target missing" }));
    if (operation === "deploy") {
      // Re-check after lock acquisition to reject stale queued deployments.
      const current = yield* readPreviewPullRequest(repository, target.pr);
      if (current.state !== "open" || current.head !== target.head) return yield* Effect.fail(new PreviewFailure({ operation: "Preview PR changed while waiting" }));
      const head = current.head;
      const verifyCurrent = readPreviewPullRequest(repository, target.pr).pipe(Effect.flatMap((latest) =>
        latest.state === "open" && latest.head === head ? Effect.void : Effect.fail(new PreviewFailure({ operation: "Preview PR changed during deployment" }))));
      yield* deployPreviewEnvironment(owner, { head, verifyCurrent }, nodePath.resolve(flags.get("--artifacts") ?? "preview-artifact"), credentials, cf, state);
    } else {
      const manifest = yield* state.load(owner);
      if (manifest) yield* cleanupPreviewEnvironment(manifest, credentials, cf, state);
      else process.stdout.write("Preview has no ownership manifest; no resources deleted");
    }
    return yield* Effect.void;
  }), (etag) => state.unlock(owner, etag).pipe(Effect.orDie));
  return yield* Effect.void;
});

if (process.argv[1] !== undefined && import.meta.filename === nodePath.resolve(process.argv[1])) {
  try {
    await Effect.runPromise(runPreviewCommand(process.argv.slice(2)).pipe(
      Effect.catchTag("PreviewFailure", (error) => Effect.sync(() => { process.stderr.write(`${error.operation}\n`); process.exitCode = 1; })),
    ));
  } catch { process.stderr.write("Preview lifecycle failed; provider details suppressed\n"); process.exitCode = 1; }
}
