import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  type PortablePlatformConfig,
  PortablePlatformConfigSchema,
} from "../../configuration/portable_configuration.js";

const S3ConfigurationSchema = z.object(PortablePlatformConfigSchema.shape).pick({
  s3Endpoint: true,
  s3AccessKeyId: true,
  s3SecretAccessKey: true,
  s3Region: true,
  s3ForcePathStyle: true,
});

/** The caller owns this S3 client and must destroy it when its scope closes. */
export function createPortableS3Client(
  config: Pick<PortablePlatformConfig, keyof typeof S3ConfigurationSchema.shape>,
) {
  const parsed = S3ConfigurationSchema.safeParse(config);

  if (!parsed.success) {
    throw new Error("S3 configuration invalid");
  }

  const settings = parsed.data;

  return new S3Client({
    endpoint: settings.s3Endpoint,
    region: settings.s3Region ?? "us-east-1",
    forcePathStyle: settings.s3ForcePathStyle ?? true,
    credentials: {
      accessKeyId: settings.s3AccessKeyId,
      secretAccessKey: settings.s3SecretAccessKey,
    },
  });
}
