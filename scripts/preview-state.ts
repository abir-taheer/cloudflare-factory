import {
  AbortMultipartUploadCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand,
  ListMultipartUploadsCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { parsePreviewManifest, previewIo, previewPrefix } from "./preview-model.ts";
import type { PreviewFailure, PreviewManifest, PreviewOwner } from "./preview-model.ts";
import type { PreviewCredentials } from "./preview-cloudflare.ts";

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

/** Strongly consistent R2 state includes write-ahead intent and a conditional repository lock. */
export function createPreviewStateStore(credentials: PreviewCredentials): PreviewStateStore {
  const s3 = new S3Client({
    region: "auto", endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: credentials.s3Key, secretAccessKey: credentials.s3Secret },
    maxAttempts: 3,
  });
  const prefix = (owner: PreviewOwner) => `previews/${owner.repositoryId}/${owner.accountId}/`;
  const key = (owner: PreviewOwner) => `${prefix(owner)}${owner.pr}.json`;
  const load: PreviewStateStore["load"] = (owner) => previewIo("Preview manifest read failed", async () => {
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: credentials.stateBucket, Key: key(owner) }));
      if (!result.Body) throw new Error("Missing body");
      return parsePreviewManifest(JSON.parse(await result.Body.transformToString()), owner);
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  });
  const save: PreviewStateStore["save"] = (manifest) => previewIo("Preview manifest write failed", async () => {
    parsePreviewManifest(manifest, manifest.owner);
    await s3.send(new PutObjectCommand({ Bucket: credentials.stateBucket, Key: key(manifest.owner),
      Body: JSON.stringify(manifest), ContentType: "application/json" }));
  });
  const list: PreviewStateStore["list"] = (owner) => Effect.gen(function* () {
    let continuation = "";
    const manifests: PreviewManifest[] = [];
    do {
      const pageToken: string = continuation;
      const result = yield* previewIo("Preview manifest listing failed", () => s3.send(new ListObjectsV2Command({
        Bucket: credentials.stateBucket, Prefix: prefix(owner), ...(pageToken === "" ? {} : { ContinuationToken: pageToken }),
      })));
      for (const object of result.Contents ?? []) {
        const tail = object.Key?.slice(prefix(owner).length);
        if (tail === undefined || !/^[1-9]\d*\.json$/u.test(tail)) throw new Error("Preview manifest key invalid");
        const manifest = yield* load({ ...owner, pr: Number(tail.slice(0, -5)) });
        if (manifest) manifests.push(manifest);
      }
      if (result.IsTruncated === true && result.NextContinuationToken === undefined) throw new Error("Preview state cursor missing");
      continuation = result.IsTruncated === true ? (result.NextContinuationToken ?? "") : "";
    } while (continuation !== "");
    return manifests;
  });
  const emptyBucket: PreviewStateStore["emptyBucket"] = (manifest, bucket) => previewIo("Preview bucket empty failed", async () => {
    parsePreviewManifest(manifest, manifest.owner);
    if (bucket === credentials.stateBucket || bucket !== `${previewPrefix(manifest.owner)}-objects` ||
      !manifest.resources.some((resource) => resource.kind === "r2" && resource.name === bucket && resource.phase !== "planned")) {
      throw new Error("Unowned bucket");
    }
    // Writers are removed before this operation. Drain first pages until empty,
    // avoiding invalidating continuation tokens while mutating an inventory.
    for (let page = 0; page < 10_000; page++) {
      const uploads = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1000 }));
      for (const upload of uploads.Uploads ?? []) {
        if (upload.Key === undefined || upload.UploadId === undefined) throw new Error("Malformed multipart upload");
        await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: upload.Key, UploadId: upload.UploadId }));
      }
      if ((uploads.Uploads?.length ?? 0) === 0) break;
      if (page === 9999) throw new Error("Multipart drain exceeded");
    }
    for (let page = 0; page < 10_000; page++) {
      const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));
      if ((objects.Contents?.length ?? 0) === 0) return;
      const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: {
        Objects: (objects.Contents ?? []).map((object) => {
          if (object.Key === undefined) throw new Error("Missing object key");
          return { Key: object.Key };
        }), Quiet: true,
      } }));
      if ((result.Errors?.length ?? 0) > 0) throw new Error("Partial object deletion");
    }
    throw new Error("Bucket drain exceeded");
  });
  const lockKey = (owner: PreviewOwner) => `locks/${owner.repositoryId}-${owner.accountId}.json`;
  const lock: PreviewStateStore["lock"] = (owner) => previewIo("Preview lifecycle lock unavailable", async () => {
    let priorEtag = "";
    try {
      const prior = await s3.send(new GetObjectCommand({ Bucket: credentials.stateBucket, Key: lockKey(owner) }));
      const expiry = Number(await prior.Body?.transformToString());
      if (!Number.isFinite(expiry) || expiry > Date.now() || prior.ETag === undefined) throw new Error("Lock held");
      priorEtag = prior.ETag;
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
    const result = await s3.send(new PutObjectCommand({
      Bucket: credentials.stateBucket, Key: lockKey(owner), Body: String(Date.now() + 2 * 60 * 60_000),
      ...(priorEtag === "" ? { IfNoneMatch: "*" } : { IfMatch: priorEtag }),
    }));
    if (result.ETag === undefined) throw new Error("Lock version missing");
    return result.ETag;
  });
  const unlock: PreviewStateStore["unlock"] = (owner, etag) => previewIo("Preview lifecycle unlock failed", async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: credentials.stateBucket, Key: lockKey(owner), IfMatch: etag }));
  });
  return { load, save, list, emptyBucket, lock, unlock };
}
