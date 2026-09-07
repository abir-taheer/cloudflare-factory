import { z } from "zod";

const ComposeConfigurationSchema = z.object({
  services: z.record(
    z.string(),
    z.object({ environment: z.record(z.string(), z.string()).optional() }),
  ),
});

const DevelopmentProjectsSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
]);

const developmentApps = ["api", "frontend", "workflows"] as const;
const metadataKeys = new Set(["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"]);
const minimumDevelopmentSecretLength = 32;

const DevelopmentTokenSchema = z
  .string()
  .min(minimumDevelopmentSecretLength)
  .regex(/^[A-Za-z0-9_-]+$/u);

const DownloadedSettingsSchema = z.record(z.string(), z.record(z.string(), z.string()));

const mutableSettings = {
  api: z.object({
    BETTER_AUTH_SECRET: DevelopmentTokenSchema,
    EMAIL_FROM: z.email(),
  }),
  frontend: z.object({}),
  workflows: z.object({}),
};

/** Development configuration rejects foreign scopes, extra credentials and nonlocal provider settings. */
export const validateDevelopmentConfiguration = (
  baseline: unknown,
  resolved: unknown,
  projects: unknown,
  downloads: unknown,
) => {
  const base = ComposeConfigurationSchema.parse(baseline);
  const actual = ComposeConfigurationSchema.parse(resolved);
  const expectedProjects = DevelopmentProjectsSchema.parse(projects);
  const original = DownloadedSettingsSchema.parse(downloads);

  if (new Set(expectedProjects).size !== developmentApps.length) {
    throw new Error("Development Doppler projects must be independent");
  }

  for (const [index, app] of developmentApps.entries()) {
    const expected = base.services[app]?.environment;
    const environment = actual.services[app]?.environment;

    if (expected === undefined || environment === undefined) {
      throw new Error("Development Compose app configuration missing");
    }

    const validScope =
      environment["DOPPLER_PROJECT"] === expectedProjects[index] &&
      environment["DOPPLER_CONFIG"] === "dev" &&
      environment["DOPPLER_ENVIRONMENT"] === "dev";

    if (!validScope) {
      throw new Error("Development Doppler scope mismatch");
    }

    const mutable = mutableSettings[app].parse(environment);
    const downloaded = original[app];

    if (
      downloaded === undefined ||
      Object.keys(downloaded).length !== Object.keys(environment).length
    ) {
      throw new Error("Development Doppler download fidelity mismatch");
    }

    for (const [key, value] of Object.entries(downloaded)) {
      if (environment[key] !== value) {
        throw new Error("Development Doppler download fidelity mismatch");
      }
    }

    const allowedKeys = new Set([...Object.keys(expected), ...metadataKeys]);

    for (const key of Object.keys(environment)) {
      if (!allowedKeys.has(key)) {
        throw new Error("Development Doppler unexpected setting");
      }
    }

    for (const [key, value] of Object.entries(expected)) {
      if (!Object.hasOwn(mutable, key) && environment[key] !== value) {
        throw new Error("Development Doppler requires unchanged Docker provider settings");
      }
    }
  }
};
