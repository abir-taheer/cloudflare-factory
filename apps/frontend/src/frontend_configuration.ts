import { Config, type ConfigProvider, Effect } from "effect";
import { z } from "zod";
import { PublicFrontendSchema } from "./lib/runtime_schema.js";

const maximumPort = 65_535;

const FrontendPortSchema = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.int().min(1).max(maximumPort));

const NodeFrontendSchema = PublicFrontendSchema.extend({
  PORT: FrontendPortSchema,
});

const DevFrontendSchema = NodeFrontendSchema.omit({ API_URL: true }).extend({
  ENVIRONMENT: z.literal("dev"),
  VITE_API_URL: PublicFrontendSchema.shape.API_URL,
});

/** Production listener scalars are decoded with Zod without exposing invalid values. */
export function parseNodeFrontendConfiguration(provider: ConfigProvider.ConfigProvider) {
  return Effect.all({
    ENVIRONMENT: Config.string("ENVIRONMENT").parse(provider),
    API_URL: Config.string("API_URL").parse(provider),
    PORT: Config.string("PORT").parse(provider),
  }).pipe(
    Effect.flatMap((input) => Effect.try(() => NodeFrontendSchema.parse(input))),
    Effect.mapError(
      () =>
        new Error(
          "Invalid frontend environment: ENVIRONMENT dev/preview/prod, API_URL HTTP origin and PORT 1-65535 required",
        ),
    ),
  );
}

/** Vite reads explicit public settings only; no dotenv files or backend credentials. */
export function parseFrontendDevConfiguration(provider: ConfigProvider.ConfigProvider) {
  return Effect.all({
    ENVIRONMENT: Config.string("ENVIRONMENT").parse(provider),
    PORT: Config.string("PORT").parse(provider),
    VITE_API_URL: Config.string("VITE_API_URL").parse(provider),
  }).pipe(
    Effect.flatMap((input) => Effect.try(() => DevFrontendSchema.parse(input))),
    Effect.mapError(
      () =>
        new Error(
          "Invalid frontend dev environment: ENVIRONMENT dev, VITE_API_URL HTTP origin and PORT required",
        ),
    ),
  );
}
