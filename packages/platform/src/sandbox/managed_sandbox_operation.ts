import { Effect } from "effect";
import type { z } from "zod";
import { ManagedSandboxError, type ManagedSandboxFailureSchema } from "./managed_sandbox_error.js";

type ManagedSandboxOperation = z.infer<typeof ManagedSandboxFailureSchema>["operation"];

/** Invalid inputs and provider failures are sanitized before crossing the capability boundary. */
export function managedSandboxOperation<A>(
  operation: ManagedSandboxOperation,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<A>,
) {
  return Effect.tryPromise({
    try: run,
    catch: () => new ManagedSandboxError({ operation, category: "provider" }),
  }).pipe(
    Effect.interruptible,
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.fail(new ManagedSandboxError({ operation, category: "deadline" })),
    }),
    Effect.withSpan(`platform.managed_sandbox.${operation}`),
  );
}

/** Zod issues can contain user inputs, so only their failure category is returned. */
export function validateManagedSandboxInput<A>(
  schema: z.ZodType<A>,
  input: unknown,
  operation: ManagedSandboxOperation,
) {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return Effect.fail(new ManagedSandboxError({ operation, category: "invalid_input" }));
  }

  return Effect.succeed(parsed.data);
}
