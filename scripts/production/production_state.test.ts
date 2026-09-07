import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { readIntegrationConfiguration } from "../../packages/platform/src/testing/integration_configuration.ts";
import { createProductionStateOperations } from "./production_state.ts";

const configuration = Effect.runSync(
  readIntegrationConfiguration([
    "PLATFORM_STORAGE_INTEGRATION",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
  ]),
);

test(
  "real S3 production state preserves domain intents across database updates and rejects stale writes",
  {
    skip: configuration["PLATFORM_STORAGE_INTEGRATION"] !== "1",
    timeout: 30_000,
  },
  async () => {
    const client = new S3Client({
      endpoint: configuration["S3_ENDPOINT"] ?? "",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: configuration["S3_ACCESS_KEY_ID"] ?? "",
        secretAccessKey: configuration["S3_SECRET_ACCESS_KEY"] ?? "",
      },
    });

    const bucket = configuration["S3_BUCKET"] ?? "";
    const prefix = `test-${randomUUID()}`;

    const owner = {
      accountId: randomUUID().replaceAll("-", ""),
      repositoryId: "123",
      environment: "prod",
      pr: null,
    } as const;

    const identity = {
      provider: "test",
      projectId: randomUUID(),
      parentBranchId: randomUUID(),
      intentId: randomUUID(),
      branchId: null,
      endpointId: null,
      hostname: null,
    };

    const store = createProductionStateOperations(client, bucket, owner, prefix);

    try {
      const initial = await Effect.runPromise(store.load());

      assert.equal(initial, null);
      await Effect.runPromise(store.save(identity, null));

      await Effect.runPromise(
        store.saveDomains([
          {
            configuration: {
              zoneId: randomUUID().replaceAll("-", ""),
              zoneName: "example.test",
              suffix: "prod.example.test",
            },
            app: "api",
            hostname: "api.prod.example.test",
            service: `${prefix}-api`,
            phase: "creating",
            identity: null,
          },
        ]),
      );

      const stale = createProductionStateOperations(client, bucket, owner, prefix);
      const before = await Effect.runPromise(stale.load());
      const nextIdentity = { ...identity, branchId: randomUUID() };
      const hyperdriveId = randomUUID();

      await Effect.runPromise(store.save(nextIdentity, hyperdriveId));
      await assert.rejects(Effect.runPromise(stale.save(identity, null)));

      const after = await Effect.runPromise(store.load());

      assert.deepEqual(after?.domains, before?.domains);
      assert.equal(after?.identity.branchId, nextIdentity.branchId);
      assert.equal(after.hyperdriveId, hyperdriveId);
    } finally {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: `production/${owner.repositoryId}/${owner.accountId}/${prefix}.json`,
        }),
      );

      client.destroy();
    }
  },
);
