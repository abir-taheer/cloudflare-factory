import { Data } from "effect";
import { z } from "zod";

/** Public sandbox failures contain stable categories, never commands, file data or SDK causes. */
export const ManagedSandboxFailureSchema = z.object({
  operation: z.enum(["open", "execute", "read_file", "write_file", "destroy"]),
  category: z.enum(["invalid_input", "provider", "deadline", "closed", "cleanup"]),
});

/** A deadline is not evidence that the provider process was terminated. */
export class ManagedSandboxError extends Data.TaggedError("ManagedSandboxError")<
  z.infer<typeof ManagedSandboxFailureSchema>
> {}
