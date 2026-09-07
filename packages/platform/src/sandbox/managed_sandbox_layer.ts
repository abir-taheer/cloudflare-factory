import { Effect, Layer } from "effect";
import {
  ManagedSandbox,
  ManagedSandboxExecuteSchema,
  ManagedSandboxIdSchema,
  ManagedSandboxOpenSchema,
  ManagedSandboxReadSchema,
  type ManagedSandboxSession,
  ManagedSandboxWriteSchema,
} from "./managed_sandbox.js";
import { ManagedSandboxError } from "./managed_sandbox_error.js";
import type { ManagedSandboxHandle, ManagedSandboxProvider } from "./managed_sandbox_provider.js";
import {
  managedSandboxOperation,
  validateManagedSandboxInput,
} from "./managed_sandbox_operation.js";

const sandboxCleanupTimeoutMs = 10_000;

function createOwnedSandboxSession(id: string, handle: ManagedSandboxHandle) {
  const abort = new AbortController();
  let cleanup: Promise<void> | null = null;

  const destroy = managedSandboxOperation("destroy", sandboxCleanupTimeoutMs, () => {
    abort.abort();
    cleanup ??= handle.destroy();
    return cleanup;
  }).pipe(
    Effect.mapError(() => new ManagedSandboxError({ operation: "destroy", category: "cleanup" })),
  );

  const ensureOpen = Effect.suspend(() => {
    if (abort.signal.aborted) {
      return Effect.fail(new ManagedSandboxError({ operation: "open", category: "closed" }));
    }

    return Effect.void;
  });

  const session: ManagedSandboxSession = {
    id,
    execute: (input) =>
      Effect.gen(function* () {
        const request = yield* validateManagedSandboxInput(
          ManagedSandboxExecuteSchema,
          input,
          "execute",
        );

        yield* ensureOpen;

        return yield* managedSandboxOperation("execute", request.timeoutMs, (signal) =>
          handle.execute(request, AbortSignal.any([signal, abort.signal])),
        );
      }).pipe(Effect.withSpan("platform.managed_sandbox.session.execute")),
    readFile: (input) =>
      Effect.gen(function* () {
        const request = yield* validateManagedSandboxInput(
          ManagedSandboxReadSchema,
          input,
          "read_file",
        );

        yield* ensureOpen;

        return yield* managedSandboxOperation("read_file", request.timeoutMs, (signal) =>
          handle.readFile(request, AbortSignal.any([signal, abort.signal])),
        );
      }).pipe(Effect.withSpan("platform.managed_sandbox.session.read_file")),
    writeFile: (input) =>
      Effect.gen(function* () {
        const request = yield* validateManagedSandboxInput(
          ManagedSandboxWriteSchema,
          input,
          "write_file",
        );

        yield* ensureOpen;

        return yield* managedSandboxOperation("write_file", request.timeoutMs, (signal) =>
          handle.writeFile(request, AbortSignal.any([signal, abort.signal])),
        );
      }).pipe(Effect.withSpan("platform.managed_sandbox.session.write_file")),
  };

  return { session, destroy };
}

/** Only a configured provider can supply managed lifecycle; HTTP execution remains a separate service. */
export const managedSandboxLayer = (provider: ManagedSandboxProvider) => {
  const sessions = new Map<string, ReturnType<typeof createOwnedSandboxSession>>();

  return Layer.succeed(
    ManagedSandbox,
    ManagedSandbox.of({
      open: (input) =>
        Effect.gen(function* () {
          const request = yield* validateManagedSandboxInput(
            ManagedSandboxOpenSchema,
            input,
            "open",
          );

          const owned = yield* Effect.acquireRelease(
            Effect.try({
              try: () => {
                const id = crypto.randomUUID();
                const acquired = createOwnedSandboxSession(id, provider.acquire(id));

                sessions.set(id, acquired);
                return acquired;
              },
              catch: () => new ManagedSandboxError({ operation: "open", category: "provider" }),
            }),
            (resource) =>
              resource.destroy.pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    sessions.delete(resource.session.id);
                  }),
                ),
                Effect.orDie,
              ),
          );

          yield* owned.destroy.pipe(Effect.delay(request.ttlMs), Effect.orDie, Effect.forkScoped);
          return owned.session;
        }).pipe(Effect.withSpan("platform.managed_sandbox.open")),
      destroy: (input) =>
        Effect.gen(function* () {
          const id = yield* validateManagedSandboxInput(ManagedSandboxIdSchema, input, "destroy");
          const owned = sessions.get(id);

          if (owned !== undefined) {
            return yield* owned.destroy;
          }

          return yield* managedSandboxOperation("destroy", sandboxCleanupTimeoutMs, () =>
            provider.destroy(id),
          );
        }).pipe(Effect.withSpan("platform.managed_sandbox.destroy")),
    }),
  );
};
