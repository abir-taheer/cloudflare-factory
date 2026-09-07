import { Context, type Effect, type Scope } from "effect";
import { z } from "zod";
import { SandboxRequestSchema, type SandboxResult } from "../capability_services.js";
import type { ManagedSandboxError } from "./managed_sandbox_error.js";

export { ManagedSandboxError, ManagedSandboxFailureSchema } from "./managed_sandbox_error.js";
export type { ManagedSandboxHandle, ManagedSandboxProvider } from "./managed_sandbox_provider.js";

const maximumSandboxLifetimeMs = 900_000;
const maximumSandboxCommandLength = 4096;
/** Files are bounded to one MiB per operation. */
export const maximumSandboxFileBytes = 1_048_576;
const SandboxTimeoutSchema = z.number().int().positive().max(maximumSandboxLifetimeMs);

/** IDs are opaque UUIDs within the configured provider namespace; persist only this value. */
export const ManagedSandboxIdSchema = z.uuid();
/** TTL bounds the live scope; provider idle timeout is a separate recovery safeguard. */
export const ManagedSandboxOpenSchema = z.object({ ttlMs: SandboxTimeoutSchema });

/** Commands run in the provider workspace; a timeout does not itself confirm process termination. */
export const ManagedSandboxExecuteSchema = SandboxRequestSchema.extend({
  command: z.string().trim().min(1).max(maximumSandboxCommandLength),
  timeoutMs: SandboxTimeoutSchema,
});

/** Paths are workspace-relative; commands can still modify files inside their owned sandbox. */
export const ManagedSandboxReadSchema = z.object({
  path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\\]+$/u),
  timeoutMs: SandboxTimeoutSchema,
});

/** File writes carry raw bytes, without leaking a provider SDK representation. */
export const ManagedSandboxWriteSchema = ManagedSandboxReadSchema.extend({
  content: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= maximumSandboxFileBytes),
});

/** Session operations are valid only while the acquiring Effect scope remains open. */
export interface ManagedSandboxSession {
  readonly id: z.infer<typeof ManagedSandboxIdSchema>;
  readonly execute: (
    request: z.infer<typeof ManagedSandboxExecuteSchema>,
  ) => Effect.Effect<SandboxResult, ManagedSandboxError>;
  readonly readFile: (
    request: z.infer<typeof ManagedSandboxReadSchema>,
  ) => Effect.Effect<Uint8Array, ManagedSandboxError>;
  readonly writeFile: (
    request: z.infer<typeof ManagedSandboxWriteSchema>,
  ) => Effect.Effect<void, ManagedSandboxError>;
}

/** Managed providers own lifecycle and files; execute-only HTTP adapters do not implement this service. */
export interface ManagedSandboxService {
  readonly open: (
    request: z.infer<typeof ManagedSandboxOpenSchema>,
  ) => Effect.Effect<ManagedSandboxSession, ManagedSandboxError, Scope.Scope>;
  readonly destroy: (
    id: z.infer<typeof ManagedSandboxIdSchema>,
  ) => Effect.Effect<void, ManagedSandboxError>;
}

/** Scope release destroys the acquired sandbox; cleanup failure fails scope closure. */
export const ManagedSandbox = Context.Service<ManagedSandboxService>("platform/ManagedSandbox");
