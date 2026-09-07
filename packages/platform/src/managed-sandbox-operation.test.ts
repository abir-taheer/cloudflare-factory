import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import { managedSandboxOperation } from "./sandbox/managed-sandbox-operation.js";
import { ManagedSandbox } from "./sandbox/managed-sandbox.js";
import { managedSandboxLayer } from "./sandbox/managed-sandbox-layer.js";

test(
  "interrupted Effect scope executes real file cleanup and reports the cleanup deadline",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp("/tmp/platform-scope-");
    const file = `${directory}/owned`;

    try {
      await writeFile(file, "owned");

      const cleanup = managedSandboxOperation("destroy", 30, async (signal) => {
        await rm(file);
        await delay(1000, undefined, { signal });
      });

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed(file), () => cleanup.pipe(Effect.orDie));
          return yield* Effect.interrupt;
        }),
      );

      const exit = await Effect.runPromise(Effect.exit(program));

      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.hasDies(exit.cause));
      await assert.rejects(access(file), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

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
