import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { parsePreviewManifest, previewIo, previewPrefix } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewCredentials } from "./preview-cloudflare.ts";

const bucketPageLimit = 10_000;
const bucketFinalPage = 9999;

async function abortPreviewMultipartUploads(s3: S3Client, bucket: string): Promise<void> {
  for (let page = 0; page < bucketPageLimit; page++) {
    const uploads = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1000 }),
    );

    for (const upload of uploads.Uploads ?? []) {
      if (upload.Key === undefined || upload.UploadId === undefined) {
        throw new Error("Malformed multipart upload");
      }

      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }

    if ((uploads.Uploads?.length ?? 0) === 0) {
      break;
    }

    if (page === bucketFinalPage) {
      throw new Error("Multipart drain exceeded");
    }
  }
}

/** Drain only a validated owned bucket after its writers have been removed. */
export const emptyPreviewBucket = (
  s3: S3Client,
  credentials: PreviewCredentials,
  manifest: PreviewManifest,
  bucket: string,
) =>
  previewIo("Preview bucket empty failed", async () => {
    parsePreviewManifest(manifest, manifest.owner);

    if (
      bucket === credentials.stateBucket ||
      bucket !== `${previewPrefix(manifest.owner)}-objects` ||
      !manifest.resources.some(
        (resource) =>
          resource.kind === "r2" && resource.name === bucket && resource.phase !== "planned",
      )
    ) {
      throw new Error("Unowned bucket");
    }

    // Writers are removed before this operation. Drain first pages until empty,
    // avoiding invalidating continuation tokens while mutating an inventory.
    await abortPreviewMultipartUploads(s3, bucket);

    for (let page = 0; page < bucketPageLimit; page++) {
      const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));

      if ((objects.Contents?.length ?? 0) === 0) {
        return;
      }

      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: (objects.Contents ?? []).map((object) => {
              if (object.Key === undefined) {
                throw new Error("Missing object key");
              }

              return { Key: object.Key };
            }),
            Quiet: true,
          },
        }),
      );

      if ((result.Errors?.length ?? 0) > 0) {
        throw new Error("Partial object deletion");
      }
    }

    throw new Error("Bucket drain exceeded");
  });
