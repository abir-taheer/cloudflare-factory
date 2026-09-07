import { Cause, Effect, Exit, Ref } from "effect";
import { ManagedSandbox, ManagedSandboxError } from "../../../sandbox/managed_sandbox.js";
import { managedSandboxLayer } from "../../../sandbox/managed_sandbox_layer.js";
import type { ManagedSandboxProvider } from "../../../sandbox/managed_sandbox_provider.js";
import { managedSandboxOperation } from "../../../sandbox/managed_sandbox_operation.js";
import { createCloudflareManagedSandboxProvider } from "../cloudflare_managed_sandbox.js";

const probeTimeoutMs = 60_000;
const probeCleanupTimeoutMs = 10_000;
const probeExitCode = 7;
const probeText = "managed sandbox probe";
const probeFailure = () => new ManagedSandboxError({ operation: "open", category: "provider" });

function verifyRemovedSandboxFile(provider: ManagedSandboxProvider, id: string) {
  return Effect.acquireUseRelease(
    Effect.sync(() => provider.acquire(id)),
    (handle) =>
      managedSandboxOperation("execute", probeTimeoutMs, async (signal) => {
        const result = await handle.execute(
          {
            command: "test ! -e /workspace/probe.bin",
            timeoutMs: probeTimeoutMs,
          },
          signal,
        );

        if (result.exitCode !== 0) {
          throw probeFailure();
        }
      }),
    (handle) => managedSandboxOperation("destroy", probeCleanupTimeoutMs, () => handle.destroy()),
  );
}

function runSandboxCleanupProbe(
  provider: ManagedSandboxProvider,
  mode: "success" | "failure" | "interruption",
) {
  return Effect.gen(function* () {
    const ownedId = yield* Ref.make<string | null>(null);
    const operationsVerified = yield* Ref.make(false);

    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* ManagedSandbox;
        const session = yield* service.open({ ttlMs: probeTimeoutMs });

        yield* Ref.set(ownedId, session.id);

        yield* session.writeFile({
          path: "probe.bin",
          content: new TextEncoder().encode(probeText),
          timeoutMs: probeTimeoutMs,
        });

        const bytes = yield* session.readFile({ path: "probe.bin", timeoutMs: probeTimeoutMs });

        const result = yield* session.execute({
          command: `printf verified; exit ${probeExitCode}`,
          timeoutMs: probeTimeoutMs,
        });

        const fileMatches = new TextDecoder().decode(bytes) === probeText;
        const commandMatches = result.stdout === "verified" && result.exitCode === probeExitCode;

        if (!fileMatches || !commandMatches) {
          return yield* Effect.fail(probeFailure());
        }

        yield* Ref.set(operationsVerified, true);

        if (mode === "failure") {
          return yield* Effect.fail(probeFailure());
        }

        if (mode === "interruption") {
          return yield* Effect.interrupt;
        }

        return true;
      }),
    ).pipe(Effect.provide(managedSandboxLayer(provider)), Effect.exit);

    const id = yield* Ref.get(ownedId);
    const verified = yield* Ref.get(operationsVerified);

    if (!verified || id === null) {
      return yield* Effect.fail(probeFailure());
    }

    const cleanupFailed = Exit.isFailure(exit) && Cause.hasDies(exit.cause);
    const expectedSuccess = mode === "success";

    if (cleanupFailed || Exit.isSuccess(exit) !== expectedSuccess) {
      return yield* Effect.fail(probeFailure());
    }

    yield* verifyRemovedSandboxFile(provider, id);
    return id;
  }).pipe(Effect.withSpan("platform.managed_sandbox.probe.cleanup"));
}

/** Opt-in trusted deployed probe only: starts owned containers, verifies cleanup, then destroys observer containers. */
export const runCloudflareSandboxProbe = (
  binding: Parameters<typeof createCloudflareManagedSandboxProvider>[0],
  namespace: string,
) =>
  Effect.gen(function* () {
    const provider = createCloudflareManagedSandboxProvider(binding, namespace);
    const successId = yield* runSandboxCleanupProbe(provider, "success");
    const failureId = yield* runSandboxCleanupProbe(provider, "failure");
    const interruptionId = yield* runSandboxCleanupProbe(provider, "interruption");
    return { successId, failureId, interruptionId };
  }).pipe(Effect.withSpan("platform.managed_sandbox.probe"));
