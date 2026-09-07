import { Layer } from "effect";
import { type S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { ObjectStore } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
/** S3 adapter accepts a caller-owned client, including explicit S3-compatible endpoints. */
export const s3ObjectStoreLayer = (client: S3Client, bucket: string) => Layer.succeed(ObjectStore, ObjectStore.of({
  put: (key, body) => capabilityOperation("objectStore", "put", async () => { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })); }),
  get: (key) => capabilityOperation("objectStore", "get", async () => {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) throw new Error("S3 object response has no body");
      return await object.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === "NoSuchKey") return null;
      throw error;
    }
  }),
  delete: (key) => capabilityOperation("objectStore", "delete", async () => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }),
}));
