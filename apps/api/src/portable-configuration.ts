import { Config, ConfigProvider, Effect, Schema } from 'effect';
import type { PortablePlatformConfig } from '@factory/platform/portable';

const nonemptySetting = Schema.String.check(Schema.isPattern(/^\S+$/u));
const endpointSchema = (protocols: readonly string[]) => nonemptySetting.check(Schema.makeFilter((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return protocols.includes(url.protocol) && url.hostname.length > 0 && url.hash.length === 0;
}));
const storageEndpointSchema = endpointSchema(['http:', 'https:']).check(Schema.makeFilter((value) => {
  const url = new URL(value);
  return url.username.length === 0 && url.password.length === 0 && url.search.length === 0;
}));
const temporalAddressSchema = nonemptySetting.check(Schema.makeFilter((value) => {
  if (!URL.canParse(`http://${value}`)) return false;
  const url = new URL(`http://${value}`);
  return url.hostname.length > 0 && url.port.length > 0 && url.username.length === 0 && url.password.length === 0 && url.pathname === '/' && url.search.length === 0 && url.hash.length === 0;
}));
const portableEnvironmentConfig = Config.schema(Schema.Struct({
  ENVIRONMENT: Schema.Literals(['dev', 'preview', 'prod']),
  DATABASE_URL: endpointSchema(['postgres:', 'postgresql:']),
  REDIS_URL: endpointSchema(['redis:', 'rediss:']),
  S3_ENDPOINT: storageEndpointSchema,
  S3_ACCESS_KEY_ID: nonemptySetting,
  S3_SECRET_ACCESS_KEY: nonemptySetting,
  S3_BUCKET: nonemptySetting,
  SMTP_HOST: nonemptySetting,
  SMTP_PORT: Schema.Int.check(Schema.isBetween({minimum:1, maximum:65_535})),
  TEMPORAL_ADDRESS: temporalAddressSchema,
  TEMPORAL_NAMESPACE: nonemptySetting,
  TEMPORAL_TASK_QUEUE: nonemptySetting,
  PLATFORM_NAMESPACE: nonemptySetting,
}));

/** Explicit provider supports isolated deployment tests without mutating process environment. */
export const parsePortableConfiguration = (provider: ConfigProvider.ConfigProvider) => portableEnvironmentConfig.parse(provider).pipe(
  Effect.map((value): PortablePlatformConfig => ({
    databaseUrl:value.DATABASE_URL, redisUrl:value.REDIS_URL,
    s3Endpoint:value.S3_ENDPOINT, s3AccessKeyId:value.S3_ACCESS_KEY_ID,
    s3SecretAccessKey:value.S3_SECRET_ACCESS_KEY, s3Bucket:value.S3_BUCKET,
    smtpHost:value.SMTP_HOST, smtpPort:value.SMTP_PORT,
    temporalAddress:value.TEMPORAL_ADDRESS, temporalNamespace:value.TEMPORAL_NAMESPACE,
    taskQueue:value.TEMPORAL_TASK_QUEUE, namespace:value.PLATFORM_NAMESPACE,
    workflowType:'processNoteWorkflow',
  })),
  Effect.mapError(() => new Error('Invalid portable environment: require dev/preview/prod, provider URLs and credentials, SMTP_HOST/SMTP_PORT (1-65535), TEMPORAL_ADDRESS (host:port), TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE and PLATFORM_NAMESPACE')),
);

/** API and workflow startup share the same validated provider configuration; no endpoint defaults. */
export const readPortableConfiguration = (): PortablePlatformConfig => Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnv()));
