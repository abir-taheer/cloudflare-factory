/* oxlint-disable import/max-dependencies -- Composition root wires all seven real provider clients and layers. */

import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { createClient } from "redis";
import { S3Client } from "@aws-sdk/client-s3";
import { Client, Connection } from "@temporalio/client";
import { createTransport } from "nodemailer";
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

const maximumTcpPort = 65_535;

/** Explicit portable configuration; no production credential or endpoint fallbacks. */
export interface PortablePlatformConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3Endpoint: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3Bucket: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecure?: boolean;
  readonly smtpAuth?: { user: string; pass: string };
  readonly temporalAddress: string;
  readonly temporalNamespace?: string;
  readonly workflowType: string;
  readonly taskQueue: string;
  readonly namespace: string;
}

function validatePortableConfiguration(config: PortablePlatformConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (typeof value === "string" && !value.trim()) {
      throw new Error(`Portable configuration missing: ${name}`);
    }
  }

  if (
    !config.namespace ||
    !config.databaseUrl ||
    !config.redisUrl ||
    !config.s3Endpoint ||
    !config.s3AccessKeyId ||
    !config.s3SecretAccessKey ||
    !config.s3Bucket ||
    !config.smtpHost ||
    !config.temporalAddress ||
    !config.workflowType ||
    !config.taskQueue
  ) {
    throw new Error("Portable configuration missing required field");
  }

  if (
    !Number.isInteger(config.smtpPort) ||
    config.smtpPort < 1 ||
    config.smtpPort > maximumTcpPort
  ) {
    throw new Error("Portable SMTP port invalid");
  }
}

function portableSmtpAuthentication(config: PortablePlatformConfig) {
  if (config.smtpAuth === undefined) {
    return {};
  }

  return { auth: config.smtpAuth };
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

      const smtpAuthentication = portableSmtpAuthentication(config);

      const smtp = yield* Effect.acquireRelease(
        capabilityOperation("email", "connect", async () =>
          createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure ?? false,
            ...smtpAuthentication,
          }),
        ),
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
