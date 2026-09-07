import { z } from "zod";
import { Context, type Effect } from "effect";
import type { CapabilityError } from "./capability-error.js";
import type { CapabilityUnavailable } from "./capability-unavailable.js";

/** Provider failure; operation and cause preserve diagnostics without claiming success. */
export { CapabilityError } from "./capability-error.js";
/** Missing optional capability fails explicitly at use time. */
export { CapabilityUnavailable } from "./capability-unavailable.js";

/** Stored note; createdAt is an ISO 8601 timestamp supplied by the caller. */
export const NoteRecordSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export type NoteRecord = z.infer<typeof NoteRecordSchema>;

/** Durable job identity is supplied by the caller; delivery may occur more than once. */
export const BackgroundJobSchema = NoteRecordSchema.pick({ id: true, ownerUserId: true }).extend({
  noteId: z.string(),
});

export type BackgroundJob = z.infer<typeof BackgroundJobSchema>;

/** Database contract intentionally supports only note create and read. */
export interface DatabaseService {
  readonly health: () => Effect.Effect<void, CapabilityError>;
  readonly createNote: (note: NoteRecord) => Effect.Effect<void, CapabilityError>;
  readonly getNote: (
    id: string,
    ownerUserId: string,
  ) => Effect.Effect<NoteRecord | null, CapabilityError>;
}

/** Portable database service key, using Effect v4 function syntax. */
export const Database = Context.Service<DatabaseService>("@factory/platform/Database");

/** Binary object contents; missing keys are null. */
export interface ObjectStoreService {
  readonly put: (key: string, body: Uint8Array) => Effect.Effect<void, CapabilityError>;
  readonly get: (key: string) => Effect.Effect<Uint8Array | null, CapabilityError>;
  readonly delete: (key: string) => Effect.Effect<void, CapabilityError>;
}

/** Portable object store service key. */
export const ObjectStore = Context.Service<ObjectStoreService>("@factory/platform/ObjectStore");

/** String cache, with optional expiration in whole seconds (minimum 60). */
export interface KeyValueService {
  readonly get: (key: string) => Effect.Effect<string | null, CapabilityError>;
  readonly put: (
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => Effect.Effect<void, CapabilityError>;
  readonly delete: (key: string) => Effect.Effect<void, CapabilityError>;
}

/** Portable key value service key; cache consistency is provider dependent. */
export const KeyValue = Context.Service<KeyValueService>("@factory/platform/KeyValue");

/** Enqueue confirms acceptance only; consumers must handle duplicate jobs. */
export interface QueueService {
  readonly enqueue: (job: BackgroundJob) => Effect.Effect<void, CapabilityError>;
}

/** Portable background queue service key. */
export const Queue = Context.Service<QueueService>("@factory/platform/Queue");

/** Starts a preconfigured workflow implementation and returns its instance ID. */
export interface WorkflowService {
  readonly start: (job: BackgroundJob) => Effect.Effect<string, CapabilityError>;
}

/** Portable workflow service key. */
export const Workflow = Context.Service<WorkflowService>("@factory/platform/Workflow");

/** Expiring lease; token must be unique per attempt, and release checks ownership. */
export interface CoordinatorService {
  readonly acquire: (
    key: string,
    token: string,
    ttlMs: number,
  ) => Effect.Effect<boolean, CapabilityError>;
  readonly release: (key: string, token: string) => Effect.Effect<boolean, CapabilityError>;
}

/** Portable coordinator service key; leases do not provide fencing. */
export const Coordinator = Context.Service<CoordinatorService>("@factory/platform/Coordinator");

/** Plain text outbound message; sender must be authorized by the provider. */
export const EmailMessageSchema = z.object({
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
});

export type EmailMessage = z.infer<typeof EmailMessageSchema>;

/** Email acceptance does not guarantee final delivery. */
export interface EmailService {
  readonly send: (message: EmailMessage) => Effect.Effect<void, CapabilityError>;
}

/** Portable email service key. */
export const Email = Context.Service<EmailService>("@factory/platform/Email");

/** Command runs exclusively in an externally isolated executor. */
export const SandboxRequestSchema = z.object({
  command: z.string(),
  timeoutMs: z.number(),
});

export type SandboxRequest = z.infer<typeof SandboxRequestSchema>;

/** Nonzero exit codes are returned as execution results. */
export const SandboxResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

export type SandboxResult = z.infer<typeof SandboxResultSchema>;

/** Sandbox is optional, with explicit typed unavailability. */
export interface SandboxService {
  readonly execute: (
    request: SandboxRequest,
  ) => Effect.Effect<SandboxResult, CapabilityError | CapabilityUnavailable>;
}

/** Portable sandbox service key. */
export const Sandbox = Context.Service<SandboxService>("@factory/platform/Sandbox");
