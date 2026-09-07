import { type ConfigProvider, Effect } from "effect";
import { z } from "zod";
import { loadConfigurationValues } from "./configuration_values.js";
import {
  TemporalEnvironmentSchema,
  TemporalSecuritySchema,
  temporalEnvironmentKeys,
} from "./temporal_configuration.js";
import {
  SmtpEnvironmentSchema,
  SmtpSecuritySchema,
  smtpEnvironmentOptions,
} from "./smtp_configuration.js";

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
  S3_REGION: NonemptySettingSchema.default("us-east-1"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),
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

/** Portable provider inputs share the same schema as environment decoding. */
export const PortablePlatformConfigSchema = SmtpSecuritySchema.safeExtend({
  databaseUrl: PortableEnvironmentSchema.shape.DATABASE_URL,
  redisUrl: PortableEnvironmentSchema.shape.REDIS_URL,
  s3Endpoint: PortableEnvironmentSchema.shape.S3_ENDPOINT,
  s3AccessKeyId: PortableEnvironmentSchema.shape.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: PortableEnvironmentSchema.shape.S3_SECRET_ACCESS_KEY,
  s3Bucket: PortableEnvironmentSchema.shape.S3_BUCKET,
  s3Region: NonemptySettingSchema.optional(),
  s3ForcePathStyle: z.boolean().optional(),
  temporalSecurity: TemporalSecuritySchema.optional(),
  smtpHost: PortableEnvironmentSchema.shape.SMTP_HOST,
  smtpPort: z.number().int().min(1).max(maximumNetworkPort),
  temporalAddress: PortableEnvironmentSchema.shape.TEMPORAL_ADDRESS,
  temporalNamespace: PortableEnvironmentSchema.shape.TEMPORAL_NAMESPACE.optional(),
  taskQueue: PortableEnvironmentSchema.shape.TEMPORAL_TASK_QUEUE,
  namespace: PortableEnvironmentSchema.shape.PLATFORM_NAMESPACE,
  workflowType: NonemptySettingSchema,
});

/** Provider configuration contains secrets and must never be logged. */
export type PortablePlatformConfig = z.infer<typeof PortablePlatformConfigSchema>;

const invalidPortableConfiguration = () =>
  new Error(
    "Invalid portable environment: require dev/preview/prod, provider URLs and credentials, SMTP_HOST/SMTP_PORT (1-65535), TEMPORAL_ADDRESS (host:port), TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE and PLATFORM_NAMESPACE",
  );

/** Zod validates provider settings from the supplied ConfigProvider before any connection opens. */
export const parsePortableConfiguration = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const values = yield* loadConfigurationValues(provider, [
      ...Object.keys(PortableEnvironmentSchema.shape),
      ...Object.keys(SmtpEnvironmentSchema.shape),
      ...temporalEnvironmentKeys,
    ]);

    const parsed = PortableEnvironmentSchema.safeParse(values);
    const smtp = SmtpEnvironmentSchema.safeParse(values);
    const temporal = TemporalEnvironmentSchema.safeParse(values);

    if (!parsed.success || !smtp.success || !temporal.success) {
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
      s3Region: value.S3_REGION,
      s3ForcePathStyle: value.S3_FORCE_PATH_STYLE,
      temporalSecurity: temporal.data,
      smtpHost: value.SMTP_HOST,
      smtpPort: value.SMTP_PORT,
      ...smtpEnvironmentOptions(smtp.data),
      temporalAddress: value.TEMPORAL_ADDRESS,
      temporalNamespace: value.TEMPORAL_NAMESPACE,
      taskQueue: value.TEMPORAL_TASK_QUEUE,
      namespace: value.PLATFORM_NAMESPACE,
      workflowType: "processNoteWorkflow",
    };

    return configuration;
  }).pipe(
    Effect.mapError(() => invalidPortableConfiguration()),
    Effect.withSpan("platform.configuration.parse"),
  );
