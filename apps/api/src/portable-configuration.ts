import { ConfigProvider, Effect } from "effect";
import { z } from "zod";
import type { PortablePlatformConfig } from "@factory/platform/portable";
import { loadConfigurationValues } from "./configuration-values.js";

const maximumNetworkPort = 65_535;
const NonemptySettingSchema = z.string().regex(/^\S+$/u);

const createEndpointSchema = (protocols: readonly string[]) =>
  NonemptySettingSchema.refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }

    const url = new URL(value);
    return protocols.includes(url.protocol) && url.hostname.length > 0 && url.hash.length === 0;
  });

const StorageEndpointSchema = createEndpointSchema(["http:", "https:"]).refine((value) => {
  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);
  return url.username.length === 0 && url.password.length === 0 && url.search.length === 0;
});

const TemporalAddressSchema = NonemptySettingSchema.refine((value) => {
  if (!URL.canParse(`http://${value}`)) {
    return false;
  }

  const url = new URL(`http://${value}`);

  return (
    url.hostname.length > 0 &&
    url.port.length > 0 &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    url.pathname === "/" &&
    url.search.length === 0 &&
    url.hash.length === 0
  );
});

const PortableEnvironmentSchema = z.object({
  ENVIRONMENT: z.enum(["dev", "preview", "prod"]),
  DATABASE_URL: createEndpointSchema(["postgres:", "postgresql:"]),
  REDIS_URL: createEndpointSchema(["redis:", "rediss:"]),
  S3_ENDPOINT: StorageEndpointSchema,
  S3_ACCESS_KEY_ID: NonemptySettingSchema,
  S3_SECRET_ACCESS_KEY: NonemptySettingSchema,
  S3_BUCKET: NonemptySettingSchema,
  SMTP_HOST: NonemptySettingSchema,
  SMTP_PORT: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximumNetworkPort)),
  TEMPORAL_ADDRESS: TemporalAddressSchema,
  TEMPORAL_NAMESPACE: NonemptySettingSchema,
  TEMPORAL_TASK_QUEUE: NonemptySettingSchema,
  PLATFORM_NAMESPACE: NonemptySettingSchema,
});

const invalidPortableConfiguration = () =>
  new Error(
    "Invalid portable environment: require dev/preview/prod, provider URLs and credentials, SMTP_HOST/SMTP_PORT (1-65535), TEMPORAL_ADDRESS (host:port), TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE and PLATFORM_NAMESPACE",
  );

/** Zod validates provider settings from the supplied ConfigProvider before any connection opens. */
export const parsePortableConfiguration = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const values = yield* loadConfigurationValues(
      provider,
      Object.keys(PortableEnvironmentSchema.shape),
    );

    const parsed = PortableEnvironmentSchema.safeParse(values);

    if (!parsed.success) {
      return yield* Effect.fail(invalidPortableConfiguration());
    }

    const value = parsed.data;

    const configuration: PortablePlatformConfig = {
      databaseUrl: value.DATABASE_URL,
      redisUrl: value.REDIS_URL,
      s3Endpoint: value.S3_ENDPOINT,
      s3AccessKeyId: value.S3_ACCESS_KEY_ID,
      s3SecretAccessKey: value.S3_SECRET_ACCESS_KEY,
      s3Bucket: value.S3_BUCKET,
      smtpHost: value.SMTP_HOST,
      smtpPort: value.SMTP_PORT,
      temporalAddress: value.TEMPORAL_ADDRESS,
      temporalNamespace: value.TEMPORAL_NAMESPACE,
      taskQueue: value.TEMPORAL_TASK_QUEUE,
      namespace: value.PLATFORM_NAMESPACE,
      workflowType: "processNoteWorkflow",
    };

    return configuration;
  }).pipe(Effect.mapError(() => invalidPortableConfiguration()));

/** API and workflow startup share validated provider configuration without endpoint defaults. */
export const readPortableConfiguration = (): PortablePlatformConfig =>
  Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnv()));
