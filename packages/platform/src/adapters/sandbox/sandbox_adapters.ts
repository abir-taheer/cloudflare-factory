import type { z } from "zod";
import { makePlatformDecoder } from "../../parse_platform_value.js";
import { Effect, Layer } from "effect";
import {
  CapabilityUnavailable,
  Sandbox,
  type SandboxRequest,
  SandboxResultSchema,
} from "../../capability_services.js";
import { capabilityOperation } from "../capability_operation.js";

const decodeSandboxResultSchema = makePlatformDecoder(SandboxResultSchema);

interface SandboxExecutionOptions {
  timeout: number;
  signal: AbortSignal;
}

interface CloudflareSandboxHandle {
  exec(
    command: string,
    options: SandboxExecutionOptions,
  ): Promise<z.infer<typeof SandboxResultSchema>>;
}

function validateSandboxRequest(request: SandboxRequest): void {
  if (
    !request.command.trim() ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs <= 0
  ) {
    throw new Error("Sandbox execution requires a command and positive timeout");
  }
}

/** Unconfigured sandbox always fails, without executing on the application host. */
export const unavailableSandboxLayer = Layer.succeed(
  Sandbox,
  Sandbox.of({
    execute: () =>
      Effect.fail(new CapabilityUnavailable({ capability: "sandbox" })).pipe(
        Effect.withSpan("platform.sandbox.unavailable"),
      ),
  }),
);

/** Supply a real Cloudflare Sandbox SDK handle obtained with getSandbox at the host boundary. */
export const cloudflareSandboxLayer = (sandbox: CloudflareSandboxHandle) =>
  Layer.succeed(
    Sandbox,
    Sandbox.of({
      execute: (request) =>
        capabilityOperation("sandbox", "execute", async (signal) => {
          validateSandboxRequest(request);

          const result = await sandbox.exec(request.command, {
            timeout: request.timeoutMs,
            signal,
          });

          return decodeSandboxResultSchema(result);
        }),
    }),
  );
