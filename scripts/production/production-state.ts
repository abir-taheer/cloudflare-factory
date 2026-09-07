import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { z } from "zod";
import { parseProductionValue } from "./production-model.ts";
import { DatabaseIdentitySchema, DatabaseOwnerSchema } from "../shared/database/database-schema.ts";
import type { DatabaseIdentity } from "../shared/database/database-schema.ts";
import { previewIo, previewString } from "../preview/preview-model.ts";

const maximumStateBytes = 16_384;

const ProductionStateSchema = z.strictObject({
  version: z.literal(1),
  owner: DatabaseOwnerSchema,
  prefix: z.string(),
  identity: DatabaseIdentitySchema,
  hyperdriveId: z.string().nullable(),
});

/** Private state stores only identity and IDs, never URLs, passwords or runtime secrets. */
export type ProductionState = z.infer<typeof ProductionStateSchema>;

/** Conditional writes preserve the provisioning nonce across retries; this store has no delete operation. */
export const productionStateStore = (
  config: Record<string, unknown>,
  owner: ProductionState["owner"],
  prefix: string,
) =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new S3Client({
            region: "auto",
            endpoint: `https://${owner.accountId}.r2.cloudflarestorage.com`,
            maxAttempts: 3,
            credentials: {
              accessKeyId: previewString(config["R2_ACCESS_KEY_ID"]),
              secretAccessKey: previewString(config["R2_SECRET_ACCESS_KEY"]),
            },
          }),
      ),
      (connection) =>
        Effect.sync(() => {
          connection.destroy();
        }),
    );

    const bucket = previewString(config["STATE_BUCKET"]);

    if (bucket === `${prefix}-objects`) {
      throw new Error("Production state bucket cannot be bound to applications");
    }

    const key = `production/${owner.repositoryId}/${owner.accountId}/${prefix}.json`;
    let etag: string | null = null;

    const load = () =>
      previewIo("Production state read failed", async () => {
        try {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

          if (
            result.Body === undefined ||
            result.ETag === undefined ||
            (result.ContentLength ?? 0) > maximumStateBytes
          ) {
            throw new Error("Production state response invalid");
          }

          etag = result.ETag;

          const text = await result.Body.transformToString();
          const state = parseProductionValue(ProductionStateSchema, JSON.parse(text));

          if (
            state.prefix !== prefix ||
            state.owner.accountId !== owner.accountId ||
            state.owner.repositoryId !== owner.repositoryId ||
            state.owner.environment !== "prod" ||
            state.owner.pr !== null
          ) {
            throw new Error("Production state owner mismatch");
          }

          return state;
        } catch (error) {
          if (error instanceof Error && error.name === "NoSuchKey") {
            return null;
          }

          throw error;
        }
      });

    const save = (identity: DatabaseIdentity, hyperdriveId: string | null) =>
      previewIo("Production conditional state write failed", async () => {
        const state: ProductionState = { version: 1, owner, prefix, identity, hyperdriveId };

        const response = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: "application/json",
            Body: JSON.stringify(state),
            ...(etag === null ? { IfNoneMatch: "*" } : { IfMatch: etag }),
          }),
        );

        if (response.ETag === undefined) {
          throw new Error("Production state revision missing");
        }

        etag = response.ETag;
      });

    return { load, save };
  });
