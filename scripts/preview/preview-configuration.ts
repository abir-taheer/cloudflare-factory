import { z } from "zod";

const ResourcePrefixSchema = z.string().regex(/^[a-z][a-z0-9-]{0,15}$/u);

/** Resource names use only validated controller configuration, never app-provided values. */
export function readPreviewResourcePrefix(): string {
  const result = ResourcePrefixSchema.safeParse(process.env["RESOURCE_PREFIX"]);

  if (!result.success) {
    throw new Error("Preview resource prefix invalid");
  }

  return result.data;
}

/** Project config permits unrelated CI keys while projecting only the controller credential contract. */
export const PreviewControllerConfigurationSchema = z.object({
  ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
  ACCOUNT_NAME: z.string().min(1),
  RESOURCE_PREFIX: ResourcePrefixSchema,
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  STATE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  WORKERS_SUBDOMAIN: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  SANDBOX_ENABLED: z.enum(["true", "false"]).optional(),
  SANDBOX_IMAGE: z.string().min(1).optional(),
});

/** Validated controller config maps to the minimal credential capability passed to provider adapters. */
export const PreviewCredentialsSchema = PreviewControllerConfigurationSchema.transform(
  (config) => ({
    accountId: config.ACCOUNT_ID,
    token: config.CLOUDFLARE_API_TOKEN,
    stateBucket: config.STATE_BUCKET,
    s3Key: config.R2_ACCESS_KEY_ID,
    s3Secret: config.R2_SECRET_ACCESS_KEY,
    workersSubdomain: config.WORKERS_SUBDOMAIN,
    sandbox: config.SANDBOX_ENABLED === "true",
    sandboxImage: config.SANDBOX_IMAGE,
  }),
);

/** Credential types follow the validated controller projection. */
export type PreviewCredentials = z.infer<typeof PreviewCredentialsSchema>;
