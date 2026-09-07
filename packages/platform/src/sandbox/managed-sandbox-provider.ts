import type { z } from "zod";
import type { SandboxResult } from "../capability-services.js";
import type {
  ManagedSandboxExecuteSchema,
  ManagedSandboxReadSchema,
  ManagedSandboxWriteSchema,
} from "./managed-sandbox.js";

/** Provider SDK objects stay behind this capability interface; cancellation need not kill a process. */
export interface ManagedSandboxHandle {
  readonly execute: (
    request: z.infer<typeof ManagedSandboxExecuteSchema>,
    signal: AbortSignal,
  ) => Promise<SandboxResult>;
  readonly readFile: (
    request: z.infer<typeof ManagedSandboxReadSchema>,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
  readonly writeFile: (
    request: z.infer<typeof ManagedSandboxWriteSchema>,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly destroy: () => Promise<void>;
}

/** Creation is lazy and local; remote allocation must occur only after the scope owns the handle. */
export interface ManagedSandboxProvider {
  readonly acquire: (id: string) => ManagedSandboxHandle;
  readonly destroy: (id: string) => Promise<void>;
}
