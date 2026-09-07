import { createHash, createHmac } from "node:crypto";
import { DatabaseIdentitySchema } from "../shared/database/database-schema.ts";
import { Data, Effect } from "effect";
import { z } from "zod";
import { readPreviewResourcePrefix } from "./preview-configuration.ts";

const resourceScopeLength = 16;
const sessionSecretMinimumBytes = 32;

/** Preview failures never retain provider bodies, command output, or credential values. */
interface PreviewFailureDetails {
  readonly operation: string;
}

export class PreviewFailure extends Data.TaggedError("PreviewFailure")<PreviewFailureDetails> {}

/** Wrap an I/O boundary while keeping secrets out of the error channel. */
export const previewIo = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new PreviewFailure({ operation }) });

/** Accept JSON objects without trusting a deserialized manifest or provider response. */
export function previewRecord(value: unknown): Record<string, unknown> {
  const result = z.record(z.string(), z.unknown()).safeParse(value);

  if (!result.success) {
    throw new PreviewFailure({ operation: "Preview JSON object required" });
  }

  return result.data;
}

/** Require a nonempty string without including its value in diagnostics. */
export function previewString(value: unknown): string {
  const result = z.string().min(1).safeParse(value);

  if (!result.success) {
    throw new PreviewFailure({ operation: "Preview required string missing" });
  }

  return result.data;
}

const previewManifestVersion = 2;

/** Immutable account and repository identity is checked against the trusted controller context. */
export const PreviewOwnerSchema = z.object({
  repositoryId: z.string(),
  accountId: z.string(),
  pr: z.number(),
});

/** A persisted resource intent carries only a deletion-safe name, ID and lifecycle phase. */
export const PreviewResourceSchema = z.object({
  kind: z.enum([
    "kv",
    "r2",
    "queue",
    "worker",
    "workflow",
    "do",
    "container",
    "hyperdrive",
    "database",
  ]),
  name: z.string(),
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/u)
    .nullable(),
  phase: z.enum(["planned", "creating", "ready", "deleted"]),
});

/** No credentials or connection strings belong in persisted lifecycle state. */
export const PreviewManifestSchema = z.object({
  version: z.literal(previewManifestVersion),
  owner: PreviewOwnerSchema,
  head: z.string().regex(/^[a-f0-9]{40}$/u),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  status: z.enum(["deploying", "ready", "deleting", "deleted"]),
  sandbox: z.boolean(),
  database: DatabaseIdentitySchema.nullable(),
  resources: z.array(PreviewResourceSchema),
});

/** Trusted callers retain the same ownership contract as persisted state. */
export type PreviewOwner = z.infer<typeof PreviewOwnerSchema>;
/** Runtime mutations are limited to the validated resource lifecycle contract. */
export type PreviewResource = z.infer<typeof PreviewResourceSchema>;
/** State readers and writers share the manifest validation contract. */
export type PreviewManifest = z.infer<typeof PreviewManifestSchema>;

/** Stable resource names reserve a separate namespace for each repository and PR. */
export function previewPrefix(owner: PreviewOwner): string {
  if (
    !/^\d+$/u.test(owner.repositoryId) ||
    !/^[a-f0-9]{32}$/u.test(owner.accountId) ||
    !Number.isSafeInteger(owner.pr) ||
    owner.pr < 1
  ) {
    throw new PreviewFailure({ operation: "Preview owner invalid" });
  }

  const scope = createHash("sha256")
    .update(`${owner.accountId}:${owner.repositoryId}`)
    .digest("hex")
    .slice(0, resourceScopeLength);

  const prefix = readPreviewResourcePrefix();

  return `${prefix}-${scope}-pr-${owner.pr}`;
}

/** The same resource plan drives provisioning, validation, cleanup and reconciliation. */
export function previewResourcePlan(owner: PreviewOwner, sandbox = false): PreviewResource[] {
  const prefix = previewPrefix(owner);

  const entries: [PreviewResource["kind"], string][] = [
    ["kv", "cache"],
    ["r2", "objects"],
    ["queue", "jobs"],
    ["worker", "workflows"],
    ["workflow", "workflow"],
    ["do", "coordinator"],
    ["worker", "api"],
    ["worker", "frontend"],
    ["database", "postgres"],
    ["hyperdrive", "hyperdrive"],
  ];

  if (sandbox) {
    entries.push(["do", "sandbox-state"], ["container", "workflows-sandbox"]);
  }

  return entries.map(([kind, suffix]) => ({
    kind,
    name: `${prefix}-${suffix}`,
    id: null,
    phase: "planned",
  }));
}

/** Reject extra resources, malformed IDs, mismatched owners and poisoned deletion targets. */
export function parsePreviewManifest(value: unknown, owner: PreviewOwner): PreviewManifest {
  const result = PreviewManifestSchema.safeParse(value);

  if (!result.success) {
    throw new PreviewFailure({ operation: "Preview manifest validation failed" });
  }

  const data = result.data;

  if (
    data.owner.repositoryId !== owner.repositoryId ||
    data.owner.accountId !== owner.accountId ||
    data.owner.pr !== owner.pr
  ) {
    throw new PreviewFailure({ operation: "Preview manifest ownership mismatch" });
  }

  const plan = previewResourcePlan(owner, data.sandbox);

  if (data.resources.length !== plan.length) {
    throw new PreviewFailure({ operation: "Preview manifest resource set invalid" });
  }

  for (const [index, expected] of plan.entries()) {
    const actual = data.resources[index];

    if (actual === undefined || actual.kind !== expected.kind || actual.name !== expected.name) {
      throw new PreviewFailure({ operation: "Preview manifest deletion target invalid" });
    }

    expected.phase = actual.phase;
    expected.id = actual.id;
  }

  return { ...data, owner, resources: plan };
}

/** Resolve only resources in the validated deterministic plan. */
export function previewResource(manifest: PreviewManifest, suffix: string): PreviewResource {
  const resource = manifest.resources.find(
    (entry) => entry.name === `${previewPrefix(manifest.owner)}-${suffix}`,
  );

  if (!resource) {
    throw new PreviewFailure({ operation: "Preview resource not in manifest" });
  }

  return resource;
}

/** Session signing keys are stable within one PR and cryptographically separated across owners. */
export function derivePreviewSessionSecret(baseSecret: string, owner: PreviewOwner): string {
  previewPrefix(owner);

  const hasSufficientEntropy =
    new TextEncoder().encode(baseSecret).length >= sessionSecretMinimumBytes;

  if (!hasSufficientEntropy) {
    throw new PreviewFailure({ operation: "Preview base session secret too short" });
  }

  return createHmac("sha256", baseSecret)
    .update(JSON.stringify(["preview-session-v1", owner.accountId, owner.repositoryId, owner.pr]))
    .digest("hex");
}
