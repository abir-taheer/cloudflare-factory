import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewIo, previewResource, previewResourcePlan, previewRecord, derivePreviewAuthToken } from "./preview-model.ts";
import type { PreviewManifest, PreviewOwner, PreviewResource } from "./preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "./preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";
import { provisionPreviewHyperdrive } from "./preview-options.ts";
import { renderPreviewWorkerConfig, loadPreviewRuntimeBaselines } from "./preview-worker-config.ts";
import { runPreviewWrangler } from "./preview-command.ts";
import { verifyPreviewDeployment } from "./preview-verify.ts";

/** A credential-free artifact is data only; reject links, extra files and excessive input. */
export const validatePreviewArtifacts = (root: string) => previewIo("Preview artifact validation failed", async () => {
  const expected = ["api.mjs", "workflows.mjs", "frontend.mjs", "assets", "schema.sql"];
  const entries = await readdir(root);
  if (entries.length !== expected.length || entries.some((entry) => !expected.includes(entry))) throw new Error("Unexpected artifact");
  let bytes = 0;
  let count = 0;
  const inspect = async (path: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Special file");
    count += 1;
    if (count > 2000 || (bytes += stat.size) > 25 * 1024 * 1024) throw new Error("Artifact limit");
    if (stat.isDirectory()) for (const name of await readdir(path)) await inspect(nodePath.join(path, name));
  };
  await inspect(root);
  for (const entry of expected.filter((name) => name !== "assets")) {
    const stat = await lstat(nodePath.join(root, entry));
    if (!stat.isFile()) throw new Error("Expected regular file");
  }
  const stat = await lstat(nodePath.join(root, "assets"));
  if (!stat.isDirectory()) throw new Error("Expected assets directory");
});

/** Recover an uncertain create only when its write-ahead intent already owns the exact name. */
export const preparePreviewResource = (manifest: PreviewManifest, resource: PreviewResource, cf: PreviewCloudflare, state: PreviewStateStore) =>
  Effect.gen(function* () {
    const existing = yield* cf.lookupResource(resource);
    if (existing !== null && (resource.phase === "planned" || resource.phase === "deleted" || (resource.id !== null && resource.id !== existing))) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview refuses unowned resource adoption" }));
    }
    if (resource.id !== null && existing === null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview resource drift requires cleanup" }));
    resource.phase = existing === null ? "creating" : "ready";
    resource.id = existing;
    yield* state.save(manifest);
    return existing;
  });

/** Provision empty PR resources, deploy dependency-first, and verify behavior before marking ready. */
export const deployPreviewEnvironment = (
  owner: PreviewOwner, revision: { head: string; verifyCurrent: Effect.Effect<void, PreviewFailure> }, artifactRoot: string, credentials: PreviewCredentials,
  cf: PreviewCloudflare, state: PreviewStateStore,
) => Effect.gen(function* () {
  const head = revision.head;
  yield* validatePreviewArtifacts(artifactRoot);
  const runtimes = yield* loadPreviewRuntimeBaselines();
  const existingManifest = yield* state.load(owner);
  if (existingManifest && existingManifest.status !== "deleted" && (existingManifest.status === "deleting" || existingManifest.sandbox !== credentials.sandbox ||
    existingManifest.hyperdrive !== credentials.hyperdrive)) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview options changed; finish cleanup first" }));
  }
  const manifest: PreviewManifest = existingManifest?.status !== "deleted" && existingManifest !== null ? existingManifest : {
    version: 1, owner, head, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: "deploying",
    sandbox: credentials.sandbox, hyperdrive: credentials.hyperdrive,
    resources: previewResourcePlan(owner, credentials.hyperdrive, credentials.sandbox),
  };
  manifest.head = head;
  manifest.status = "deploying";
  manifest.expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  yield* state.save(manifest);
  for (const resource of manifest.resources.filter((item) => ["d1", "kv", "r2", "queue"].includes(item.kind))) {
    const existing = yield* preparePreviewResource(manifest, resource, cf, state);
    if (existing === null) resource.id = yield* cf.create(resource);
    resource.phase = "ready";
    yield* state.save(manifest);
    if ((yield* cf.lookupResource(resource)) !== resource.id) return yield* Effect.fail(new PreviewFailure({ operation: "Preview create readback failed" }));
  }
  yield* provisionPreviewHyperdrive(credentials, manifest, cf, state);
  const schema = yield* previewIo("Preview schema read failed", () => readFile(nodePath.join(artifactRoot, "schema.sql"), "utf8"));
  const schemaResult = yield* cf.request(`/d1/database/${previewResource(manifest, "database").id}/query`, "POST", { sql: schema });
  if (!Array.isArray(schemaResult) || schemaResult.some((row: unknown) => previewRecord(row)["success"] !== true)) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview schema application failed" }));
  }
  const directory = yield* previewIo("Preview temporary directory failed", () => mkdtemp("/tmp/preview-deploy-"));
  const token = derivePreviewAuthToken(credentials.authSeed, owner);
  yield* Effect.gen(function* () {
    const secrets = nodePath.join(directory, "secrets.json");
    yield* previewIo("Preview runtime secret preparation failed", () => writeFile(secrets, JSON.stringify({ API_TOKEN: token }), { mode: 0o600 }));
    for (const app of ["workflows", "api", "frontend"] as const) {
      yield* revision.verifyCurrent;
      const worker = previewResource(manifest, app);
      yield* preparePreviewResource(manifest, worker, cf, state);
      const dependents = app === "workflows" ? manifest.resources.filter((item) => ["workflow", "do", "container"].includes(item.kind)) : [];
      for (const child of dependents) yield* preparePreviewResource(manifest, child, cf, state);
      const config = renderPreviewWorkerConfig(manifest, credentials, app, nodePath.resolve(artifactRoot));
      config["vars"] = { ...previewRecord(config["vars"]), ...runtimes[app].vars };
      const path = nodePath.join(directory, `${app}.json`);
      yield* previewIo("Preview Worker configuration failed", () => writeFile(path, JSON.stringify(config), { mode: 0o600 }));
      yield* runPreviewWrangler(credentials, ["deploy", "--config", path, "--no-bundle", ...(app === "api" ? ["--secrets-file", secrets] : [])]);
      for (const item of [worker, ...dependents]) {
        item.id = yield* cf.lookupResource(item);
        if (item.id === null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview deployed resource readback failed" }));
        item.phase = "ready";
        yield* state.save(manifest);
      }
    }
    const url = `https://${previewResource(manifest, "frontend").name}.${credentials.workersSubdomain}.workers.dev`;
    yield* verifyPreviewDeployment(url, token);
    yield* revision.verifyCurrent;
    manifest.status = "ready";
    yield* state.save(manifest);
    process.stdout.write(`Preview ready for PR #${owner.pr}: ${url}\n`);
    return yield* Effect.void;
  }).pipe(Effect.ensuring(previewIo("Preview temporary file removal failed", () => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie)));
  return yield* Effect.void;
});
