import { Config, ConfigProvider, Effect, Schema } from 'effect';

const apiEnvironmentSchema = Schema.Struct({
  ENVIRONMENT: Schema.Literals(['dev', 'preview', 'prod']),
  API_TOKEN: Schema.String.check(Schema.isMinLength(20), Schema.isPattern(/^\S+$/u)),
}).check(Schema.makeFilter((value) => value.ENVIRONMENT === 'dev' || value.API_TOKEN !== 'local-development-only'));
const apiEnvironmentConfig = Config.schema(apiEnvironmentSchema).pipe(Config.map((value) => ({
  environment:value.ENVIRONMENT, token:value.API_TOKEN,
})));

/** Validate API scalar bindings without exposing credential values in configuration errors. */
export const parseApiConfiguration = (provider: ConfigProvider.ConfigProvider) => apiEnvironmentConfig.parse(provider).pipe(
  Effect.mapError(() => new Error('Invalid API environment: require ENVIRONMENT dev/preview/prod and a non-whitespace API_TOKEN of at least 20 characters; local token is dev-only')),
);

/** Node startup validates configuration before opening the HTTP listener. */
export const readApiConfiguration = () => Effect.runSync(parseApiConfiguration(ConfigProvider.fromEnv()));
