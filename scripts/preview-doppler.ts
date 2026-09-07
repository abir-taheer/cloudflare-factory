import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewString } from "./preview-model.ts";

/** Each app receives only its own validated scalar runtime configuration. */
export type DeploymentApp = "api" | "frontend" | "workflows";

/** Download only the independently expected project and fixed deployment config. */
export const loadDeploymentDoppler = (scope: "DEPLOY" | "API" | "FRONTEND" | "WORKFLOWS", environment: "preview" | "prod") =>
  previewIo("Deployment Doppler scope verification failed", async () => {
    const token = previewString(process.env[`DOPPLER_${scope}_TOKEN`]);
    const project = previewString(process.env[`DOPPLER_${scope}_PROJECT`]);
    const response = await fetch("https://api.doppler.com/v3/configs/config/secrets/download?format=json", {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new Error("Deployment Doppler download failed");
    const config = previewRecord(await response.json());
    if (config["DOPPLER_PROJECT"] !== project || config["DOPPLER_CONFIG"] !== environment) {
      throw new Error("Deployment Doppler identity mismatch");
    }
    return config;
  });

/** Explicit projection prevents controller secrets or resource IDs from entering Workers. */
export function parseDeploymentRuntime(config: Record<string, unknown>, environment: "preview" | "prod", app: DeploymentApp) {
  if (config["ENVIRONMENT"] !== environment) throw new Error("Deployment runtime environment mismatch");
  const secrets: Record<string, string> = {};
  if (app === "api" && environment === "prod") {
    const token = previewString(config["API_TOKEN"]);
    if (token.length < 20 || /\s/u.test(token) || token === "local-development-only") throw new Error("Deployment API token invalid");
    secrets["API_TOKEN"] = token;
  }
  return { vars: { ENVIRONMENT: environment }, secrets };
}

/** Preview API authentication is supplied later by the controller's per-PR HMAC overlay. */
export const loadDeploymentRuntime = (app: DeploymentApp, environment: "preview" | "prod") => Effect.gen(function* () {
  const scope = { api: "API", frontend: "FRONTEND", workflows: "WORKFLOWS" } as const;
  const config = yield* loadDeploymentDoppler(scope[app], environment);
  return yield* Effect.try({ try: () => parseDeploymentRuntime(config, environment, app),
    catch: () => new PreviewFailure({ operation: "Deployment runtime configuration invalid" }) });
});
