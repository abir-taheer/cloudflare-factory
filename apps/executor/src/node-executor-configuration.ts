import { Config, ConfigProvider, Effect, Schema } from 'effect';

const executorEnvironmentConfig = Config.schema(Schema.Struct({
  ENVIRONMENT:Schema.Literals(['dev', 'preview', 'prod']),
  EXECUTOR_TOKEN:Schema.String.check(Schema.isMinLength(20), Schema.isPattern(/^\S+$/u)),
}).check(Schema.makeFilter((value) => value.ENVIRONMENT === 'dev' || value.EXECUTOR_TOKEN !== 'local-executor-development-only')));

/** Validate executor scalars at startup; configuration errors never include token values. */
export const parseExecutorConfiguration = (provider: ConfigProvider.ConfigProvider) => executorEnvironmentConfig.parse(provider).pipe(
  Effect.mapError(() => new Error('Invalid executor environment: require ENVIRONMENT dev/preview/prod and a non-whitespace EXECUTOR_TOKEN of at least 20 characters; local token is dev-only')),
);

/** Runtime configuration has no credential fallback and uses the same names in every deployment. */
export const readExecutorConfiguration = () => Effect.runSync(parseExecutorConfiguration(ConfigProvider.fromEnv()));
