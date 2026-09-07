import { Layer } from "effect";
import type {
  Queue as CloudflareQueue,
  Workflow as CloudflareWorkflow,
  KVNamespace,
  R2Bucket,
} from "@cloudflare/workers-types";
import { type BackgroundJob, KeyValue, Queue } from "../capability-services.js";
import { capabilityOperation, validateCacheTtl } from "./capability-operation.js";
import { r2ObjectStoreLayer } from "./r2-object-store.js";
import { cloudflareWorkflowLayer } from "./cloudflare-workflow.js";
import {
  type CoordinatorNamespace,
  durableObjectCoordinatorLayer,
} from "./cloudflare-coordinator.js";
import { type HyperdriveDatabaseBinding, hyperdriveDatabaseLayer } from "./hyperdrive-database.js";

/** Cloudflare KV cache allows eventual consistency and minimum 60-second expiration. */
export const cloudflareKeyValueLayer = (binding: KVNamespace) =>
  Layer.succeed(
    KeyValue,
    KeyValue.of({
      get: (key) => capabilityOperation("keyValue", "get", () => binding.get(key)),
      put: (key, value, ttlSeconds) =>
        capabilityOperation("keyValue", "put", async () => {
          validateCacheTtl(ttlSeconds);

          if (ttlSeconds === undefined) {
            await binding.put(key, value, {});
            return;
          }

          await binding.put(key, value, { expirationTtl: ttlSeconds });
        }),
      delete: (key) => capabilityOperation("keyValue", "delete", () => binding.delete(key)),
    }),
  );

/** Cloudflare queue producer; host queue handler processes and acknowledges delivered jobs. */
export const cloudflareQueueLayer = (binding: CloudflareQueue<BackgroundJob>) =>
  Layer.succeed(
    Queue,
    Queue.of({
      enqueue: (job) => capabilityOperation("queue", "enqueue", () => binding.send(job)),
    }),
  );

/** Required Cloudflare bindings match the application deployment names. */
export interface CloudflarePlatformBindings {
  readonly HYPERDRIVE: HyperdriveDatabaseBinding;
  readonly OBJECTS: R2Bucket;
  readonly CACHE: KVNamespace;
  readonly JOBS: CloudflareQueue<BackgroundJob>;
  readonly WORKFLOW: CloudflareWorkflow<BackgroundJob>;
  readonly COORDINATOR: CoordinatorNamespace;
}

/** Build per request or workflow step; every deployed database connection uses Hyperdrive. */
export const cloudflarePlatformLayer = (bindings: CloudflarePlatformBindings) =>
  Layer.mergeAll(
    hyperdriveDatabaseLayer(bindings.HYPERDRIVE),
    r2ObjectStoreLayer(bindings.OBJECTS),
    cloudflareKeyValueLayer(bindings.CACHE),
    cloudflareQueueLayer(bindings.JOBS),
    cloudflareWorkflowLayer(bindings.WORKFLOW),
    durableObjectCoordinatorLayer(bindings.COORDINATOR),
  );

export { hyperdriveDatabaseLayer, acquireHyperdriveDrizzle } from "./hyperdrive-database.js";
export type { HyperdriveDatabaseBinding } from "./hyperdrive-database.js";
export { r2ObjectStoreLayer } from "./r2-object-store.js";
export { cloudflareWorkflowLayer } from "./cloudflare-workflow.js";
export { durableObjectCoordinatorLayer } from "./cloudflare-coordinator.js";

export { DurableObjectLeaseStorage } from "./cloudflare-coordinator.js";
export { cloudflareEmailLayer } from "./email-adapters.js";
export { captureEmailLayer, makeCaptureEmailService } from "./capture-email.js";
export { cloudflareSandboxLayer, unavailableSandboxLayer } from "./sandbox-adapters.js";
