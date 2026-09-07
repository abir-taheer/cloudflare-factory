import { access } from "node:fs/promises";
import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewString } from "./preview-model.ts";
import type { PreviewResource } from "./preview-model.ts";
import { loadDeploymentDoppler } from "./preview-doppler.ts";
import { runPreviewWrangler } from "./preview-command.ts";

/** Management credentials are loaded only in protected GitHub environment jobs. */
export interface PreviewCredentials {
  accountId: string;
  token: string;
  stateBucket: string;
  s3Key: string;
  s3Secret: string;
  authSeed: string;
  workersSubdomain: string;
  sandbox: boolean;
  sandboxImage: string | undefined;
  hyperdrive: boolean;
  databaseProvisioner: string | undefined;
  databaseProvisionerToken: string | undefined;
}

/** A replaceable control-plane adapter; no application code receives this capability. */
export interface PreviewCloudflare {
  request: (path: string, method?: string, body?: unknown) => Effect.Effect<unknown, PreviewFailure>;
  list: (path: string) => Effect.Effect<Record<string, unknown>[], PreviewFailure>;
  lookupResource: (resource: PreviewResource) => Effect.Effect<string | null, PreviewFailure>;
  create: (resource: PreviewResource) => Effect.Effect<string, PreviewFailure>;
  remove: (resource: PreviewResource, id: string) => Effect.Effect<void, PreviewFailure>;
}

function parsePreviewOptionalCapabilities(config: Record<string, unknown>) {
  const optional = (key: string) => config[key] === undefined ? undefined : previewString(config[key]);
  const flag = (key: string) => {
    if (config[key] === undefined || config[key] === "false") return false;
    if (config[key] === "true") return true;
    throw new Error("Boolean configuration invalid");
  };
  const sandbox = flag("PREVIEW_SANDBOX");
  const sandboxImage = optional("PREVIEW_SANDBOX_IMAGE");
  if (sandbox && (config["PREVIEW_ALLOW_PAID_SANDBOX"] !== "true" ||
    sandboxImage === undefined || !/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$/u.test(sandboxImage))) {
    throw new Error("Sandbox requires paid consent and trusted immutable image");
  }
  const hyperdrive = flag("PREVIEW_HYPERDRIVE");
  const databaseProvisioner = optional("PREVIEW_DATABASE_PROVISIONER_URL");
  const databaseProvisionerToken = optional("PREVIEW_DATABASE_PROVISIONER_TOKEN");
  if (hyperdrive) {
    const url = new URL(previewString(databaseProvisioner));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || databaseProvisionerToken === undefined) {
      throw new Error("Empty database provisioner required");
    }
  }
  return { sandbox, sandboxImage, hyperdrive, databaseProvisioner, databaseProvisionerToken };
}

/** Fetch a config-scoped Doppler token without printing or exporting the downloaded config. */
export const loadPreviewCredentials = (local = false) => previewIo("Preview protected configuration invalid", async () => {
  if (local) await access("/.dockerenv");
  if (!local && (process.env["GITHUB_ACTIONS"] !== "true" || process.env["PREVIEW_ENVIRONMENT"] !== "cloudflare-preview")) {
    throw new Error("Protected environment required");
  }
  const config = await Effect.runPromise(loadDeploymentDoppler("DEPLOY", "preview"));
  const accountId = previewString(config["ACCOUNT_ID"]);
  if (!/^[a-f0-9]{32}$/u.test(accountId) || accountId !== process.env["CLOUDFLARE_ACCOUNT_ID"] ||
    previewString(config["ACCOUNT_NAME"]) !== previewString(process.env["CLOUDFLARE_ACCOUNT_NAME"])) throw new Error("Account mismatch");
  const { sandbox, sandboxImage, hyperdrive, databaseProvisioner, databaseProvisionerToken } = parsePreviewOptionalCapabilities(config);
  const credentials: PreviewCredentials = {
    accountId, token: previewString(config["CLOUDFLARE_API_TOKEN"]),
    stateBucket: previewString(config["PREVIEW_STATE_BUCKET"]),
    s3Key: previewString(config["PREVIEW_R2_ACCESS_KEY_ID"]),
    s3Secret: previewString(config["PREVIEW_R2_SECRET_ACCESS_KEY"]),
    authSeed: previewString(config["PREVIEW_AUTH_SEED"]),
    workersSubdomain: previewString(config["PREVIEW_WORKERS_SUBDOMAIN"]),
    sandbox, sandboxImage, hyperdrive, databaseProvisioner, databaseProvisionerToken,
  };
  if (new TextEncoder().encode(credentials.authSeed).length < 32) throw new Error("Auth seed too short");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(credentials.stateBucket) ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(credentials.workersSubdomain)) throw new Error("Naming configuration invalid");
  return credentials;
});

const resourcePaths = {
  d1: "/d1/database", kv: "/storage/kv/namespaces", r2: "/r2/buckets", queue: "/queues",
  worker: "/workers/scripts", workflow: "/workflows", hyperdrive: "/hyperdrive/configs", database: "",
  do: "/workers/durable_objects/namespaces", container: "/containers/applications",
};

/** REST calls redact provider response bodies and paginate every supported inventory. */
export function createPreviewCloudflare(credentials: PreviewCredentials): PreviewCloudflare {
  const raw = (path: string, method = "GET", body?: unknown) => previewIo("Preview Cloudflare request failed", async () => {
    if (!path.startsWith("/") || path.includes("..")) throw new Error("Invalid API path");
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}${path}`, {
      method, headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Provider request failed");
    if (response.status === 204) return { success: true, result: null };
    const text = await response.text();
    if (text.length === 0 && method === "DELETE") return { success: true, result: null };
    const envelope = previewRecord(JSON.parse(text));
    if (envelope["success"] !== true) throw new Error("Provider envelope failed");
    return envelope;
  });
  const request: PreviewCloudflare["request"] = (path, method, body) => raw(path, method, body).pipe(
    Effect.map((envelope) => envelope === null ? null : envelope["result"]),
  );
  const list: PreviewCloudflare["list"] = (path) => Effect.gen(function* () {
    const entries: Record<string, unknown>[] = [];
    let cursor = "";
    for (let page = 1; page <= 10_000; page++) {
      const query = new URLSearchParams({ per_page: "100", ...(cursor === "" ? { page: String(page) } : { cursor }) });
      const envelope = yield* raw(`${path}?${query}`);
      if (envelope === null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview inventory unavailable" }));
      const result = envelope["result"];
      const resultObject = Array.isArray(result) ? undefined : previewRecord(result);
      const rows = Array.isArray(result) ? result : resultObject?.["buckets"];
      if (!Array.isArray(rows)) return yield* Effect.fail(new PreviewFailure({ operation: "Preview inventory shape invalid" }));
      entries.push(...rows.map((value: unknown) => previewRecord(value)));
      const info = envelope["result_info"] === undefined ? {} : previewRecord(envelope["result_info"]);
      const next = info["cursor"] ?? resultObject?.["cursor"];
      if (path === "/r2/buckets" && (typeof next !== "string" || next.length === 0)) return entries;
      if (typeof next === "string" && next.length > 0) {
        if (next === cursor) return yield* Effect.fail(new PreviewFailure({ operation: "Preview inventory cursor stalled" }));
        cursor = next;
      } else if (typeof info["total_pages"] === "number") {
        if (page >= info["total_pages"]) return entries;
      } else if (rows.length < 100 || path === "/workers/scripts") return entries;
    }
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview inventory pagination exceeded" }));
  });
  const find: PreviewCloudflare["lookupResource"] = (resource) => Effect.gen(function* () {
    if (resource.kind === "database") return yield* Effect.fail(new PreviewFailure({ operation: "Preview database requires external adapter" }));
    const rawRows: unknown = resource.kind === "container"
      ? JSON.parse(yield* runPreviewWrangler(credentials, ["containers", "list", "--json"]))
      : yield* list(resourcePaths[resource.kind]);
    if (!Array.isArray(rawRows)) return yield* Effect.fail(new PreviewFailure({ operation: "Preview container inventory invalid" }));
    const rows = rawRows.map((value: unknown) => previewRecord(value));
    const matches = rows.filter((row) => resource.kind === "do"
      ? row["script"] === resource.name.replace(/-(?:coordinator|sandbox-state)$/u, "-workflows") &&
        row["class"] === (resource.name.endsWith("-coordinator") ? "JobCoordinator" : "Sandbox")
      : (row["name"] ?? row["title"] ?? row["queue_name"] ?? row["id"]) === resource.name);
    if (matches.length > 1) return yield* Effect.fail(new PreviewFailure({ operation: "Preview duplicate resource names" }));
    const match = matches[0];
    if (!match) return null;
    return previewString(match["uuid"] ?? match["queue_id"] ?? match["id"] ?? match["name"]);
  });
  const create: PreviewCloudflare["create"] = (resource) => Effect.gen(function* () {
    let body: Record<string, string> = { name: resource.name };
    if (resource.kind === "kv") body = { title: resource.name };
    if (resource.kind === "queue") body = { queue_name: resource.name };
    if (!["d1", "kv", "r2", "queue"].includes(resource.kind)) return yield* Effect.fail(new PreviewFailure({ operation: "Preview resource requires deployment adapter" }));
    const result = previewRecord(yield* request(resourcePaths[resource.kind], "POST", body));
    return previewString(result["uuid"] ?? result["queue_id"] ?? result["id"] ?? result["name"]);
  });
  const remove: PreviewCloudflare["remove"] = (resource, id) => resource.kind === "container"
    ? runPreviewWrangler(credentials, ["containers", "delete", id]).pipe(Effect.asVoid)
    : request(
    `${resourcePaths[resource.kind]}/${encodeURIComponent(resource.kind === "workflow" ? resource.name : id)}${resource.kind === "worker" ? "?force=true" : ""}`, "DELETE",
  ).pipe(Effect.asVoid);
  return { request, list, lookupResource: find, create, remove };
}

/** Identity readback occurs before any provisioning or deletion. */
export const verifyPreviewAccount = (credentials: PreviewCredentials) => previewIo("Preview account identity verification failed", async () => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}`, {
    headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  if (!response.ok) throw new Error("Account unavailable");
  const account = previewRecord(previewRecord(await response.json())["result"]);
  if (account["id"] !== credentials.accountId || account["name"] !== previewString(process.env["CLOUDFLARE_ACCOUNT_NAME"])) throw new Error("Account identity mismatch");
});
