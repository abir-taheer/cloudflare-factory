import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { Sandbox } from "./capability-services.js";
import { httpSandboxLayer } from "./adapters/sandbox-adapters.js";
import { readIntegrationConfiguration } from "./testing/integration-configuration.js";

const configuration = Effect.runSync(
  readIntegrationConfiguration(["PLATFORM_EXECUTOR_INTEGRATION", "EXECUTOR_URL", "EXECUTOR_TOKEN"]),
);

const enabled = configuration["PLATFORM_EXECUTOR_INTEGRATION"] === "1";

test(
  "real Docker HTTP executor preserves output and nonzero exit, rejects authentication and deadline",
  {
    skip: !enabled,
    timeout: 10_000,
  },
  async () => {
    const endpoint = configuration["EXECUTOR_URL"];
    const token = configuration["EXECUTOR_TOKEN"];
    assert.ok(endpoint !== undefined && token !== undefined);

    const layer = httpSandboxLayer(endpoint, token);

    const result = await Effect.runPromise(
      Sandbox.use((sandbox) =>
        sandbox.execute({
          command: "printf portable; printf diagnostic >&2; exit 7",
          timeoutMs: 2000,
        }),
      ).pipe(Effect.provide(layer)),
    );

    assert.deepEqual(result, { stdout: "portable", stderr: "diagnostic", exitCode: 7 });

    const denied = await Effect.runPromise(
      Sandbox.use((sandbox) =>
        sandbox.execute({
          command: "true",
          timeoutMs: 2000,
        }),
      ).pipe(Effect.provide(httpSandboxLayer(endpoint, "incorrect-token")), Effect.flip),
    );

    assert.equal(denied._tag, "CapabilityError");

    const deadline = await Effect.runPromise(
      Sandbox.use((sandbox) =>
        sandbox.execute({
          command: "sleep 1",
          timeoutMs: 50,
        }),
      ).pipe(Effect.provide(layer), Effect.flip),
    );

    assert.equal(deadline._tag, "CapabilityError");
  },
);
