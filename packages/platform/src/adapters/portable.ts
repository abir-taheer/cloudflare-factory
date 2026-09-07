/* oxlint-disable import/max-dependencies -- Composition root wires all seven real provider clients and layers. */

import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { createClient } from "redis";
import { S3Client } from "@aws-sdk/client-s3";
import { Client, Connection } from "@temporalio/client";
import { createPortableSmtpTransport } from "./smtp-transport.js";
import { postgresDatabaseLayer } from "./postgres-database.js";
import { s3ObjectStoreLayer } from "./s3-object-store.js";
import {
  redisCoordinatorLayer,
  redisKeyValueLayer,
  redisQueueLayer,
} from "./redis-capabilities.js";
import { temporalWorkflowLayer } from "./temporal-workflow.js";
import { smtpEmailLayer } from "./email-adapters.js";
import { capabilityOperation } from "./capability-operation.js";
import {
  type PortablePlatformConfig,
  PortablePlatformConfigSchema,
} from "../configuration/portable-configuration.js";

export type { PortablePlatformConfig } from "../configuration/portable-configuration.js";

function validatePortableConfiguration(config: PortablePlatformConfig): void {
  const parsed = PortablePlatformConfigSchema.safeParse(config);

  if (!parsed.success) {
    throw new Error("Portable configuration invalid");
  }
}

/** Scoped portable layers close acquired clients when the consuming Effect scope ends. */
export const portablePlatformLayer = (config: PortablePlatformConfig) =>
  Layer.unwrap(
    Effect.gen(function* () {
      yield* capabilityOperation("platform", "configure", async () => {
        validatePortableConfiguration(config);
      });

      const pool = yield* Effect.acquireRelease(
        capabilityOperation(
          "database",
          "connect",
          async () => new Pool({ connectionString: config.databaseUrl }),
        ),
        (acquiredPool) =>
          Effect.promise(() => acquiredPool.end()).pipe(Effect.withSpan("platform.database.close")),
      );

      const redis = yield* Effect.acquireRelease(
        capabilityOperation("redis", "create", async () => {
          const client = createClient({
            RESP: 2,
            url: config.redisUrl,
            socket: { reconnectStrategy: false },
          });

          client.on("error", () => {
            /* Command promises carry failures into typed operations. */
          });

          return client;
        }),
        (client) =>
          Effect.sync(() => {
            if (client.isOpen) {
              client.destroy();
            }
          }).pipe(Effect.withSpan("platform.redis.close")),
      );

      yield* capabilityOperation("redis", "connect", () => redis.connect());

      const s3 = yield* Effect.acquireRelease(
        capabilityOperation(
          "objectStore",
          "connect",
          async () =>
            new S3Client({
              endpoint: config.s3Endpoint,
              region: "us-east-1",
              forcePathStyle: true,
              credentials: {
                accessKeyId: config.s3AccessKeyId,
                secretAccessKey: config.s3SecretAccessKey,
              },
            }),
        ),
        (client) =>
          Effect.sync(() => {
            client.destroy();
          }).pipe(Effect.withSpan("platform.objectStore.close")),
      );

      const connection = yield* Effect.acquireRelease(
        capabilityOperation("workflow", "connect", () =>
          Connection.connect({ address: config.temporalAddress }),
        ),
        (acquiredConnection) =>
          Effect.promise(() => acquiredConnection.close()).pipe(
            Effect.withSpan("platform.workflow.close"),
          ),
      );

      const smtp = yield* Effect.acquireRelease(
        capabilityOperation("email", "connect", async () => createPortableSmtpTransport(config)),
        (transport) =>
          Effect.sync(() => {
            transport.close();
          }).pipe(Effect.withSpan("platform.email.close")),
      );

      return Layer.mergeAll(
        postgresDatabaseLayer(pool),
        s3ObjectStoreLayer(s3, config.s3Bucket),
        redisKeyValueLayer(redis, `${config.namespace}:cache:`),
        redisQueueLayer(redis, `${config.namespace}:jobs`),
        redisCoordinatorLayer(redis, `${config.namespace}:leases:`),
        smtpEmailLayer(smtp),
        temporalWorkflowLayer(
          new Client({ connection, namespace: config.temporalNamespace ?? "default" }),
          config.workflowType,
          config.taskQueue,
        ),
      );
    }).pipe(Effect.withSpan("platform.portable.acquire")),
  );

export {
  postgresDatabaseLayer,
  s3ObjectStoreLayer,
  redisCoordinatorLayer,
  redisKeyValueLayer,
  redisQueueLayer,
  temporalWorkflowLayer,
  smtpEmailLayer,
};

export { consumeRedisJobs, ensureRedisQueueGroup, reclaimRedisJobs } from "./redis-capabilities.js";
export { httpSandboxLayer, unavailableSandboxLayer } from "./sandbox-adapters.js";
export { captureEmailLayer, makeCaptureEmailService } from "./capture-email.js";
