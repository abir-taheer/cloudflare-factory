import { getSandbox } from "@cloudflare/sandbox";
import { z } from "zod";
import { SandboxResultSchema } from "../capability-services.js";
import { managedSandboxLayer } from "../sandbox/managed-sandbox-layer.js";
import type {
  ManagedSandboxHandle,
  ManagedSandboxProvider,
} from "../sandbox/managed-sandbox-provider.js";
import { readSandboxFileBytes } from "./cloudflare-sandbox-files.js";

const SandboxNamespaceSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u);
type CloudflareSandboxNamespace = Parameters<typeof getSandbox>[0];
type CloudflareSandboxHandle = ReturnType<typeof getSandbox>;

function wrapCloudflareSandbox(sandbox: CloudflareSandboxHandle): ManagedSandboxHandle {
  return {
    execute: async (request, signal) => {
      const result = await sandbox.exec(request.command, {
        timeout: request.timeoutMs,
        cwd: "/workspace",
        signal,
      });

      return SandboxResultSchema.parse(result);
    },
    readFile: async (request, signal) => {
      signal.throwIfAborted();

      const file = await sandbox.readFile(`/workspace/${request.path}`, { encoding: "none" });
      return readSandboxFileBytes(file.content, signal);
    },
    writeFile: async (request, signal) => {
      signal.throwIfAborted();

      const content = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(request.content);
          controller.close();
        },
      });

      const result = await sandbox.writeFile(`/workspace/${request.path}`, content);
      signal.throwIfAborted();

      if (!result.success) {
        throw new Error("Sandbox file write failed");
      }
    },
    destroy: () => sandbox.destroy(),
  };
}

/** Real Cloudflare RPC provider; namespace must belong exclusively to this application's managed sessions. */
export function createCloudflareManagedSandboxProvider(
  binding: CloudflareSandboxNamespace,
  namespace: string,
) {
  const parsed = SandboxNamespaceSchema.safeParse(namespace);

  if (!parsed.success) {
    throw new Error("Sandbox namespace invalid");
  }

  const acquire = (id: string) => {
    const sandbox = getSandbox(binding, `${parsed.data}-${id}`, {
      transport: "rpc",
      normalizeId: true,
      sleepAfter: "1m",
      enableDefaultSession: false,
    });

    return wrapCloudflareSandbox(sandbox);
  };

  return {
    acquire,
    destroy: (id) => acquire(id).destroy(),
  } satisfies ManagedSandboxProvider;
}

/** This optional layer never enables Cloudflare containers or changes account billing. */
export function cloudflareManagedSandboxLayer(
  binding: CloudflareSandboxNamespace,
  namespace: string,
) {
  const provider = createCloudflareManagedSandboxProvider(binding, namespace);
  return managedSandboxLayer(provider);
}
