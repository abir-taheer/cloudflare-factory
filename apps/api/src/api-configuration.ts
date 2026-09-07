import { ConfigProvider, Effect } from "effect";
import { z } from "zod";
import { AuthenticationConfigurationSchema } from "@factory/auth/configuration";
import { loadConfigurationValues } from "@factory/platform/configuration";

/** API runtime configuration extends the shared authentication contract without duplicate fields. */
export const ApiConfigurationSchema = AuthenticationConfigurationSchema.extend({
  emailDelivery: z.enum(["smtp", "cloudflare", "capture"]),
}).refine((value) => value.emailDelivery !== "capture" || value.environment === "preview");

const ApiEnvironmentSchema = z.object({
  ENVIRONMENT: ApiConfigurationSchema.shape.environment,
  API_URL: ApiConfigurationSchema.shape.apiUrl,
  FRONTEND_ORIGINS: z
    .string()
    .transform((value): readonly string[] => value.split(",").map((origin) => origin.trim()))
    .pipe(ApiConfigurationSchema.shape.frontendOrigins),
  BETTER_AUTH_SECRET: ApiConfigurationSchema.shape.secret,
  EMAIL_FROM: ApiConfigurationSchema.shape.emailFrom,
  EMAIL_DELIVERY: ApiConfigurationSchema.shape.emailDelivery,
});

const ApiConfigurationInputSchema = ApiEnvironmentSchema.transform((value) => ({
  environment: value.ENVIRONMENT,
  apiUrl: value.API_URL,
  frontendOrigins: value.FRONTEND_ORIGINS,
  secret: value.BETTER_AUTH_SECRET,
  emailFrom: value.EMAIL_FROM,
  emailDelivery: value.EMAIL_DELIVERY,
})).pipe(ApiConfigurationSchema);

const invalidApiConfiguration = () =>
  new Error(
    "Invalid API environment: require exact API_URL and FRONTEND_ORIGINS, BETTER_AUTH_SECRET, EMAIL_FROM and explicit EMAIL_DELIVERY; capture is preview-only",
  );

/** Zod validates scalar configuration; provider errors and validation issues never expose secrets. */
export const parseApiConfiguration = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const values = yield* loadConfigurationValues(
      provider,
      Object.keys(ApiEnvironmentSchema.shape),
    );

    const parsed = ApiConfigurationInputSchema.safeParse(values);

    if (!parsed.success) {
      return yield* Effect.fail(invalidApiConfiguration());
    }

    return parsed.data;
  }).pipe(Effect.mapError(() => invalidApiConfiguration()));

/** Node startup validates configuration before opening the HTTP listener. */
export const readApiConfiguration = () =>
  Effect.runSync(parseApiConfiguration(ConfigProvider.fromEnv()));
