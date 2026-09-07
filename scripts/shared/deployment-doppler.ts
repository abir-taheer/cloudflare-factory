import { Effect } from "effect";
import { z } from "zod";
import {
  PreviewFailure,
  previewIo,
  previewRecord,
  previewString,
} from "../preview/preview-model.ts";

const dopplerTimeoutMs = 30_000;
const sessionSecretMinimumLength = 32;

/** Each app receives only its own validated scalar runtime configuration. */
export type DeploymentApp = "api" | "frontend" | "workflows";

/** Download only the independently expected project and fixed deployment config. */
export const loadDeploymentDoppler = (
  scope: "DEPLOY" | "API" | "FRONTEND" | "WORKFLOWS",
  environment: "preview" | "prod",
) =>
  previewIo("Deployment Doppler scope verification failed", async () => {
    const token = previewString(process.env[`DOPPLER_${scope}_TOKEN`]);
    const project = previewString(process.env[`DOPPLER_${scope}_PROJECT`]);

    const response = await fetch(
      "https://api.doppler.com/v3/configs/config/secrets/download?format=json",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(dopplerTimeoutMs),
        redirect: "error",
      },
    );

    if (!response.ok) {
      throw new Error("Deployment Doppler download failed");
    }

    const result: unknown = await response.json();
    const config = previewRecord(result);

    if (config["DOPPLER_PROJECT"] !== project || config["DOPPLER_CONFIG"] !== environment) {
      throw new Error("Deployment Doppler identity mismatch");
    }

    return config;
  });

const DeploymentApiOriginSchema = z
  .string()
  .min(1)
  .refine((origin) => {
    try {
      const url = new URL(origin);

      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.origin === origin &&
        !url.hostname.includes("*")
      );
    } catch {
      return false;
    }
  });

const DeploymentApiSecretsSchema = z.object({
  BETTER_AUTH_SECRET: z.string().refine((secret) => secret.length >= sessionSecretMinimumLength),
  EMAIL_FROM: z.string().min(1),
});

/** Public app origins cannot contain credentials, paths, queries or wildcard hosts. */
export function parseDeploymentApiOrigin(value: unknown): string {
  const result = DeploymentApiOriginSchema.safeParse(value);

  if (!result.success) {
    throw new Error("Deployment public origin invalid");
  }

  return result.data;
}

/** Explicit projection prevents controller secrets or resource IDs from entering Workers. */
export function parseDeploymentRuntime(
  config: Record<string, unknown>,
  environment: "preview" | "prod",
  app: DeploymentApp,
) {
  const scopeResult = z.object({ ENVIRONMENT: z.literal(environment) }).safeParse(config);

  if (!scopeResult.success) {
    throw new Error("Deployment runtime environment mismatch");
  }

  const vars: Record<string, string> = { ENVIRONMENT: environment };
  const secrets: Record<string, string> = {};

  if (environment === "prod" && app !== "workflows") {
    vars["API_URL"] = parseDeploymentApiOrigin(config["API_URL"]);
  }

  if (app === "api") {
    const secretResult = DeploymentApiSecretsSchema.safeParse(config);

    if (!secretResult.success) {
      throw new Error("Deployment session configuration invalid");
    }

    secrets["BETTER_AUTH_SECRET"] = secretResult.data.BETTER_AUTH_SECRET;
    vars["EMAIL_FROM"] = secretResult.data.EMAIL_FROM;

    if (environment === "prod") {
      const origins = previewString(config["FRONTEND_ORIGINS"])
        .split(",")
        .map((origin) => parseDeploymentApiOrigin(origin.trim()));

      vars["FRONTEND_ORIGINS"] = origins.join(",");
    }
  }

  return { vars, secrets };
}

/** Runtime session secrets come only from the API app config; public URLs are controller-overlaid for previews. */
export const loadDeploymentRuntime = (app: DeploymentApp, environment: "preview" | "prod") =>
  Effect.gen(function* () {
    const scope = { api: "API", frontend: "FRONTEND", workflows: "WORKFLOWS" } as const;
    const config = yield* loadDeploymentDoppler(scope[app], environment);

    return yield* Effect.try({
      try: () => parseDeploymentRuntime(config, environment, app),
      catch: () => new PreviewFailure({ operation: "Deployment runtime configuration invalid" }),
    });
  });
