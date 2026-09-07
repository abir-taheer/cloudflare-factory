import { Config, ConfigProvider, Effect, Schema } from "effect";

const frontendEnvironmentSchema = Schema.Literals(["dev", "preview", "prod"]);
const frontendApiOriginSchema = Schema.String.check(Schema.isPattern(/^\S+$/u), Schema.makeFilter((value) => {
  if (!URL.canParse(value)) return false;
  const origin = new URL(value);
  return ["http:", "https:"].includes(origin.protocol) && origin.hostname.length > 0 &&
    origin.username.length === 0 && origin.password.length === 0 && origin.pathname === "/" &&
    origin.search.length === 0 && origin.hash.length === 0;
}));
const frontendScalarConfig = Config.schema(Schema.Struct({ ENVIRONMENT: frontendEnvironmentSchema }));
const nodeFrontendConfig = Config.schema(Schema.Struct({
  ENVIRONMENT: frontendEnvironmentSchema,
  API_URL: frontendApiOriginSchema,
  PORT: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))
}));

/** Validate the same frontend scalar keys in dev, preview and prod; never infer an environment. */
export const parseFrontendScalars = (provider: ConfigProvider.ConfigProvider) => frontendScalarConfig.parse(provider).pipe(
  Effect.mapError(() => new Error("Invalid frontend environment: ENVIRONMENT must be dev, preview or prod"))
);

/** Node frontend configuration requires an explicit API origin and TCP port in every environment. */
export const parseNodeFrontendConfiguration = (provider: ConfigProvider.ConfigProvider) => nodeFrontendConfig.parse(provider).pipe(
  Effect.mapError(() => new Error("Invalid frontend environment: require ENVIRONMENT dev/preview/prod, API_URL HTTP(S) origin without credentials/path/query/fragment, and PORT integer 1-65535"))
);

/** Read Node configuration once through Effect's environment provider before opening a listener. */
export const readNodeFrontendConfiguration = () => Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnv()));

/** Validate programmatic frontend server origins with the same schema as the Node environment. */
export const parseFrontendApiOrigin = (value: unknown): URL => new URL(Effect.runSync(
  Schema.decodeUnknownEffect(frontendApiOriginSchema)(value).pipe(
    Effect.mapError(() => new Error("Invalid frontend API_URL: require an HTTP(S) origin without credentials/path/query/fragment"))
  )
));
