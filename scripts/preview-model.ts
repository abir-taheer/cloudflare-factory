import { createHash, createHmac } from "node:crypto";
import { Data, Effect } from "effect";

/** Preview failures never retain provider bodies, command output, or credential values. */
export class PreviewFailure extends Data.TaggedError("PreviewFailure")<{
  readonly operation: string;
}> {}

/** Wrap an I/O boundary while keeping secrets out of the error channel. */
export const previewIo = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new PreviewFailure({ operation }) });

/** Accept JSON objects without trusting a deserialized manifest or provider response. */
export function previewRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PreviewFailure({ operation: "Preview JSON object required" });
  }
  return Object.fromEntries(Object.entries(value));
}

/** Require a nonempty string without including its value in diagnostics. */
export function previewString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PreviewFailure({ operation: "Preview required string missing" });
  }
  return value;
}

/** Ownership includes immutable repository and account IDs, not a mutable repository name. */
export interface PreviewOwner {
  readonly repositoryId: string;
  readonly accountId: string;
  readonly pr: number;
}

/** A manifest records intent before creation; IDs are checked against live names before deletion. */
export interface PreviewResource {
  kind: "d1" | "kv" | "r2" | "queue" | "worker" | "workflow" | "do" | "container" | "hyperdrive" | "database";
  name: string;
  id: string | null;
  phase: "planned" | "creating" | "ready" | "deleted";
}

/** No credentials or database connection strings belong in the lifecycle manifest. */
export interface PreviewManifest {
  version: 1;
  owner: PreviewOwner;
  head: string;
  expiresAt: string;
  status: "deploying" | "ready" | "deleting" | "deleted";
  sandbox: boolean;
  hyperdrive: boolean;
  resources: PreviewResource[];
}

/** Stable resource names reserve a separate namespace for each repository and PR. */
export function previewPrefix(owner: PreviewOwner): string {
  if (!/^\d+$/u.test(owner.repositoryId) || !/^[a-f0-9]{32}$/u.test(owner.accountId) ||
    !Number.isSafeInteger(owner.pr) || owner.pr < 1) {
    throw new PreviewFailure({ operation: "Preview owner invalid" });
  }
  const scope = createHash("sha256").update(`${owner.accountId}:${owner.repositoryId}`).digest("hex").slice(0, 16);
  return `cfp-${scope}-pr-${owner.pr}`;
}

/** The same resource plan drives provisioning, validation, cleanup and reconciliation. */
export function previewResourcePlan(owner: PreviewOwner, hyperdrive = false, sandbox = false): PreviewResource[] {
  const prefix = previewPrefix(owner);
  const entries: [PreviewResource["kind"], string][] = [
    ["d1", "database"], ["kv", "cache"], ["r2", "objects"], ["queue", "jobs"],
    ["worker", "workflows"], ["workflow", "workflow"], ["do", "coordinator"], ["worker", "api"], ["worker", "frontend"],
  ];
  if (hyperdrive) entries.push(["database", "postgres"], ["hyperdrive", "hyperdrive"]);
  if (sandbox) entries.push(["do", "sandbox-state"], ["container", "workflows-sandbox"]);
  return entries.map(([kind, suffix]) => ({ kind, name: `${prefix}-${suffix}`, id: null, phase: "planned" }));
}

/** Reject extra resources, malformed IDs, mismatched owners and poisoned deletion targets. */
export function parsePreviewManifest(value: unknown, owner: PreviewOwner): PreviewManifest {
  const data = previewRecord(value);
  const storedOwner = previewRecord(data["owner"]);
  if (data["version"] !== 1 || storedOwner["repositoryId"] !== owner.repositoryId ||
    storedOwner["accountId"] !== owner.accountId || storedOwner["pr"] !== owner.pr ||
    typeof data["sandbox"] !== "boolean" || typeof data["hyperdrive"] !== "boolean") {
    throw new PreviewFailure({ operation: "Preview manifest ownership mismatch" });
  }
  const head = previewString(data["head"]);
  const expiresAt = previewString(data["expiresAt"]);
  const status = data["status"];
  if (!/^[a-f0-9]{40}$/u.test(head) || !Number.isFinite(Date.parse(expiresAt)) ||
    (status !== "deploying" && status !== "ready" && status !== "deleting" && status !== "deleted")) {
    throw new PreviewFailure({ operation: "Preview manifest lifecycle invalid" });
  }
  const plan = previewResourcePlan(owner, data["hyperdrive"], data["sandbox"]);
  const resources = data["resources"];
  if (!Array.isArray(resources) || resources.length !== plan.length) {
    throw new PreviewFailure({ operation: "Preview manifest resource set invalid" });
  }
  for (const [index, expected] of plan.entries()) {
    const actual = previewRecord(resources[index]);
    const phase = actual["phase"];
    const id = actual["id"];
    if (actual["kind"] !== expected.kind || actual["name"] !== expected.name ||
      (phase !== "planned" && phase !== "creating" && phase !== "ready" && phase !== "deleted") ||
      (id !== null && (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)))) {
      throw new PreviewFailure({ operation: "Preview manifest deletion target invalid" });
    }
    expected.phase = phase;
    expected.id = id;
  }
  return { version: 1, owner, head, expiresAt, status, sandbox: data["sandbox"], hyperdrive: data["hyperdrive"], resources: plan };
}

/** Resolve only resources in the validated deterministic plan. */
export function previewResource(manifest: PreviewManifest, suffix: string): PreviewResource {
  const resource = manifest.resources.find((entry) => entry.name === `${previewPrefix(manifest.owner)}-${suffix}`);
  if (!resource) throw new PreviewFailure({ operation: "Preview resource not in manifest" });
  return resource;
}

/** Derive a stable per-PR token; the seed stays in the management plane and never enters a Worker. */
export function derivePreviewAuthToken(seed: string, owner: PreviewOwner): string {
  previewPrefix(owner);
  if (new TextEncoder().encode(seed).length < 32) throw new PreviewFailure({ operation: "Preview auth seed must contain at least 32 random bytes" });
  return createHmac("sha256", seed).update(JSON.stringify(["cloudflare-preview-auth-v1", owner.accountId, owner.repositoryId, owner.pr])).digest("hex");
}
