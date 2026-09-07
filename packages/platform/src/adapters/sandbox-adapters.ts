import { Effect, Layer, Schema } from "effect";
import { Sandbox, CapabilityUnavailable, type SandboxRequest } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";

const SandboxResponse = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, exitCode: Schema.Number });
function validateSandboxRequest(request: SandboxRequest): void {
  if (!request.command.trim() || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) throw new Error("Sandbox execution requires a command and positive timeout");
}
/** Unconfigured sandbox always fails, without executing on the application host. */
export const unavailableSandboxLayer = Layer.succeed(Sandbox, Sandbox.of({
  execute: () => Effect.fail(new CapabilityUnavailable({ capability: "sandbox" })),
}));
/** HTTP executor must isolate commands; endpoint is trusted configuration and redirects are rejected. */
export const httpSandboxLayer = (endpoint: string, bearerToken: string) => Layer.succeed(Sandbox, Sandbox.of({
  execute: (request) => capabilityOperation("sandbox", "execute", async () => {
    validateSandboxRequest(request);
    if (!bearerToken) throw new Error("Sandbox HTTP executor bearer token missing");
    const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(request.timeoutMs) });
    if (!response.ok) throw new Error(`Sandbox HTTP executor failed: ${response.status}`);
    const result = Schema.decodeUnknownSync(SandboxResponse)(await response.json());
    if (!Number.isSafeInteger(result.exitCode)) throw new Error("Sandbox HTTP executor exit code invalid");
    return result;
  }),
}));
/** Supply a real Cloudflare Sandbox SDK handle obtained with getSandbox at the host boundary. */
export const cloudflareSandboxLayer = (sandbox: { exec(command: string, options: { timeout: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> }) => Layer.succeed(Sandbox, Sandbox.of({
  execute: (request) => capabilityOperation("sandbox", "execute", async () => {
    validateSandboxRequest(request);
    return Schema.decodeUnknownSync(SandboxResponse)(await sandbox.exec(request.command, { timeout: request.timeoutMs }));
  }),
}));
