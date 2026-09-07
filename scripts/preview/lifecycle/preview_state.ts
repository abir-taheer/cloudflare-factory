import type { ListObjectsV2CommandInput } from "@aws-sdk/client-s3";
import { emptyPreviewBucket } from "../cloudflare/preview_bucket_cleanup.ts";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { parsePreviewManifest, previewIo } from "../preview_model.ts";
import type { PreviewFailure, PreviewManifest, PreviewOwner } from "../preview_model.ts";
import type { PreviewCredentials } from "../cloudflare/preview_cloudflare.ts";

const manifestSuffixLength = 5;
const controllerLockLifetimeMs = 7_200_000;

/** Replaceable manifest store; application Workers never bind the control bucket. */
export interface PreviewStateStore {
  load: (owner: PreviewOwner) => Effect.Effect<PreviewManifest | null, PreviewFailure>;
  save: (manifest: PreviewManifest) => Effect.Effect<void, PreviewFailure>;
  list: (owner: PreviewOwner) => Effect.Effect<PreviewManifest[], PreviewFailure>;
  emptyBucket: (manifest: PreviewManifest, bucket: string) => Effect.Effect<void, PreviewFailure>;
  lock: (owner: PreviewOwner) => Effect.Effect<string, PreviewFailure>;
  unlock: (owner: PreviewOwner, etag: string) => Effect.Effect<void, PreviewFailure>;
}

function isMissingObject(error: unknown): boolean {
  return error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound");
}

function createPreviewManifestListing(
  s3: S3Client,
  credentials: PreviewCredentials,
  load: PreviewStateStore["load"],
): PreviewStateStore["list"] {
  const prefix = (owner: PreviewOwner) => `previews/${owner.repositoryId}/${owner.accountId}/`;

  return (owner) =>
    Effect.gen(function* () {
      let continuation = "";
      const manifests: PreviewManifest[] = [];

      do {
        const pageToken: string = continuation;
        const options = { Bucket: credentials.stateBucket, Prefix: prefix(owner) };
        const pagination: Pick<ListObjectsV2CommandInput, "ContinuationToken"> = {};

        if (pageToken !== "") {
          pagination.ContinuationToken = pageToken;
        }

        const result = yield* previewIo("Preview manifest listing failed", () =>
          s3.send(
            new ListObjectsV2Command({
              ...options,
              ...pagination,
            }),
          ),
        );

        for (const object of result.Contents ?? []) {
          const tail = object.Key?.slice(prefix(owner).length);

          if (tail === undefined || !/^[1-9]\d*\.json$/u.test(tail)) {
            throw new Error("Preview manifest key invalid");
          }

          const manifest = yield* load({
            ...owner,
            pr: Number(tail.slice(0, -manifestSuffixLength)),
          });

          if (manifest) {
            manifests.push(manifest);
          }
        }

        if (result.IsTruncated === true && result.NextContinuationToken === undefined) {
          throw new Error("Preview state cursor missing");
        }

        continuation = "";

        if (result.IsTruncated === true) {
          continuation = result.NextContinuationToken ?? "";
        }
      } while (continuation !== "");

      return manifests;
    });
}

/** Strongly consistent R2 state includes write-ahead intent and a conditional repository lock. */
export function createPreviewStateStore(credentials: PreviewCredentials): PreviewStateStore {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: credentials.s3Key, secretAccessKey: credentials.s3Secret },
    maxAttempts: 3,
  });

  const prefix = (owner: PreviewOwner) => `previews/${owner.repositoryId}/${owner.accountId}/`;
  const key = (owner: PreviewOwner) => `${prefix(owner)}${owner.pr}.json`;

  const load: PreviewStateStore["load"] = (owner) =>
    previewIo("Preview manifest read failed", async () => {
      try {
        const result = await s3.send(
          new GetObjectCommand({ Bucket: credentials.stateBucket, Key: key(owner) }),
        );

        if (!result.Body) {
          throw new Error("Missing body");
        }

        const text = await result.Body.transformToString();
        return parsePreviewManifest(JSON.parse(text), owner);
      } catch (error) {
        if (isMissingObject(error)) {
          return null;
        }

        throw error;
      }
    });

  const save: PreviewStateStore["save"] = (manifest) =>
    previewIo("Preview manifest write failed", async () => {
      parsePreviewManifest(manifest, manifest.owner);

      await s3.send(
        new PutObjectCommand({
          Bucket: credentials.stateBucket,
          Key: key(manifest.owner),
          Body: JSON.stringify(manifest),
          ContentType: "application/json",
        }),
      );
    });

  const list = createPreviewManifestListing(s3, credentials, load);

  const emptyBucket: PreviewStateStore["emptyBucket"] = (manifest, bucket) =>
    emptyPreviewBucket(s3, credentials, manifest, bucket);

  const lockKey = (owner: PreviewOwner) => `locks/${owner.repositoryId}-${owner.accountId}.json`;

  const lock: PreviewStateStore["lock"] = (owner) =>
    previewIo("Preview lifecycle lock unavailable", async () => {
      let priorEtag = "";

      try {
        const prior = await s3.send(
          new GetObjectCommand({ Bucket: credentials.stateBucket, Key: lockKey(owner) }),
        );

        const text = await prior.Body?.transformToString();
        const expiry = Number(text);

        if (!Number.isFinite(expiry) || expiry > Date.now() || prior.ETag === undefined) {
          throw new Error("Lock held");
        }

        priorEtag = prior.ETag;
      } catch (error) {
        if (!isMissingObject(error)) {
          throw error;
        }
      }

      const result = await s3.send(
        new PutObjectCommand({
          Bucket: credentials.stateBucket,
          Key: lockKey(owner),
          Body: String(Date.now() + controllerLockLifetimeMs),
          ...(priorEtag === "" ? { IfNoneMatch: "*" } : { IfMatch: priorEtag }),
        }),
      );

      if (result.ETag === undefined) {
        throw new Error("Lock version missing");
      }

      return result.ETag;
    });

  const unlock: PreviewStateStore["unlock"] = (owner, etag) =>
    previewIo("Preview lifecycle unlock failed", async () => {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: credentials.stateBucket,
          Key: lockKey(owner),
          IfMatch: etag,
        }),
      );
    });

  return { load, save, list, emptyBucket, lock, unlock };
}
