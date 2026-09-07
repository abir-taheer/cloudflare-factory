import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewResource, previewString } from "./preview-model.ts";
import type { PreviewManifest } from "./preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "./preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";

/** External databases must be independently provisioned; an existing connection URL is never accepted. */
export const previewDatabaseRequest = (
  credentials: PreviewCredentials, manifest: PreviewManifest, method: "GET" | "PUT" | "DELETE",
) => previewIo("Preview empty database provisioner failed", async () => {
  if (credentials.databaseProvisioner === undefined || credentials.databaseProvisionerToken === undefined) throw new Error("Missing provisioner");
  const resource = previewResource(manifest, "postgres");
  const response = await fetch(`${credentials.databaseProvisioner.replace(/\/$/u, "")}/${resource.name}`, {
    method, redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${credentials.databaseProvisionerToken}`, "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify({ name: resource.name, owner: manifest.owner, empty: true,
      independent: true, schemaVersion: "notes-v1", expiresAt: manifest.expiresAt }) } : {}),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Provisioner unavailable");
  if (method === "DELETE") return null;
  const result = previewRecord(await response.json());
  const owner = previewRecord(result["owner"]);
  if (result["name"] !== resource.name || result["id"] !== resource.name || result["independent"] !== true ||
    result["source"] !== "empty" || result["schemaVersion"] !== "notes-v1" || owner["repositoryId"] !== manifest.owner.repositoryId ||
    owner["accountId"] !== manifest.owner.accountId || owner["pr"] !== manifest.owner.pr) throw new Error("Database ownership rejected");
  return result;
});

/** Hyperdrive origins come exclusively from a verified, newly created external database. */
export const provisionPreviewHyperdrive = (
  credentials: PreviewCredentials, manifest: PreviewManifest, cf: PreviewCloudflare, state: PreviewStateStore,
) => Effect.gen(function* () {
  if (!manifest.hyperdrive) return yield* Effect.void;
  const database = previewResource(manifest, "postgres");
  if (database.phase === "planned") {
    if ((yield* previewDatabaseRequest(credentials, manifest, "GET")) !== null) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview refuses existing external database" }));
    }
    database.phase = "creating";
    yield* state.save(manifest);
  }
  let details = yield* previewDatabaseRequest(credentials, manifest, "GET");
  details ??= yield* previewDatabaseRequest(credentials, manifest, "PUT");
  if (details === null) return yield* Effect.fail(new PreviewFailure({ operation: "Preview empty database missing" }));
  database.id = database.name;
  database.phase = "ready";
  yield* state.save(manifest);
  const hyperdrive = previewResource(manifest, "hyperdrive");
  const existing = yield* cf.lookupResource(hyperdrive);
  if ((existing !== null && hyperdrive.phase === "planned") || (hyperdrive.id !== null && hyperdrive.id !== existing)) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview Hyperdrive ownership mismatch" }));
  }
  if (existing !== null) { hyperdrive.id = existing; hyperdrive.phase = "ready"; yield* state.save(manifest); return yield* Effect.void; }
  hyperdrive.phase = "creating";
  yield* state.save(manifest);
  const origin = previewRecord(details["origin"]);
  if (origin["scheme"] !== "postgresql" || typeof origin["port"] !== "number" ||
    !Number.isInteger(origin["port"]) || origin["port"] < 1 || origin["port"] > 65_535) {
    return yield* Effect.fail(new PreviewFailure({ operation: "Preview database origin invalid" }));
  }
  const result = previewRecord(yield* cf.request("/hyperdrive/configs", "POST", {
    name: hyperdrive.name, origin: { scheme: "postgresql", host: previewString(origin["host"]),
      port: origin["port"], database: previewString(origin["database"]),
      user: previewString(origin["user"]), password: previewString(origin["password"]) },
    caching: { disabled: true }, mtls: { sslmode: "verify-full" }, origin_connection_limit: 5,
  }));
  hyperdrive.id = previewString(result["id"]);
  hyperdrive.phase = "ready";
  yield* state.save(manifest);
  return yield* Effect.void;
});
