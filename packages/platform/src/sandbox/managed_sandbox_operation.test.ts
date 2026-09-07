import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Exit } from "effect";
import { managedSandboxOperation } from "./managed_sandbox_operation.js";
import { ManagedSandbox } from "./managed_sandbox.js";
import { managedSandboxLayer } from "./managed_sandbox_layer.js";

test("interrupted Effect scope executes real file cleanup", { timeout: 5000 }, async () => {
  const directory = await mkdtemp("/tmp/platform-scope-");
  const file = `${directory}/owned`;

  try {
    await writeFile(file, "owned");

    const cleanup = managedSandboxOperation("destroy", 5000, () => rm(file));

    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.succeed(file), () => cleanup.pipe(Effect.orDie));
        return yield* Effect.interrupt;
      }),
    );

    const exit = await Effect.runPromise(Effect.exit(program));

    assert.ok(Exit.isFailure(exit));
    await assert.rejects(access(file), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stalled sandbox provider reports its deadline", { timeout: 5000 }, async () => {
  const cleanup = managedSandboxOperation("destroy", 30, (signal) =>
    delay(60_000, undefined, { signal }),
  );

  const failure = await Effect.runPromise(Effect.flip(cleanup));
  assert.equal(failure.category, "deadline");
});

test(
  "explicit destroy closes the retained session and scope release does not repeat file cleanup",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp("/tmp/platform-destroy-");
    const file = `${directory}/owned`;

    try {
      await writeFile(file, "owned");

      const unsupported = () =>
        Promise.reject(
          new Error("File cleanup fixture does not execute commands or file operations"),
        );

      const destroy = () => rm(file);

      const layer = managedSandboxLayer({
        acquire: () => ({
          execute: unsupported,
          readFile: unsupported,
          writeFile: unsupported,
          destroy,
        }),
        destroy,
      });

      const failure = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const service = yield* ManagedSandbox;
            const session = yield* service.open({ ttlMs: 1000 });

            yield* service.destroy(session.id);
            return yield* session.execute({ command: "true", timeoutMs: 1000 }).pipe(Effect.flip);
          }),
        ).pipe(Effect.provide(layer)),
      );

      assert.equal(failure.category, "closed");
      await assert.rejects(access(file), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
