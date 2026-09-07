import { z } from "zod";
import { Effect, Schedule } from "effect";
import { previewIo, previewRecord } from "../preview/preview_model.ts";

const publicRuntimeKeys = 2;
const smokeRequestTimeoutMs = 10_000;
const httpUnauthorized = 401;
const smokePropagationRetries = 20;

const ProductionUrlsSchema = z.strictObject({ api: z.url(), frontend: z.url() });
type ProductionUrls = z.infer<typeof ProductionUrlsSchema>;

const verifyProductionFrontend = async (urls: ProductionUrls) => {
  const page = await fetch(urls.frontend, {
    redirect: "error",
    signal: AbortSignal.timeout(smokeRequestTimeoutMs),
  });

  const html = await page.text();

  if (!page.ok || page.headers.get("content-security-policy") === null || !html.includes("<html")) {
    throw new Error("Production frontend failed");
  }

  const runtime = await fetch(`${urls.frontend}/runtime-config.json`, {
    redirect: "error",
    signal: AbortSignal.timeout(smokeRequestTimeoutMs),
  });

  const runtimeBody = await runtime.json();
  const configuration = previewRecord(runtimeBody);

  if (
    !runtime.ok ||
    configuration["API_URL"] !== urls.api ||
    configuration["ENVIRONMENT"] !== "prod" ||
    Object.keys(configuration).length !== publicRuntimeKeys
  ) {
    throw new Error("Production frontend runtime configuration failed");
  }
};

/** Production smoke is read-only: no synthetic users, session secrets, notes or jobs. */
export const verifyProductionApplication = (
  urls: ProductionUrls,
  app: "api" | "frontend" | "workflows" | "all",
) =>
  previewIo("Production behavior verification failed", async () => {
    const request = (path: string) =>
      fetch(`${urls.api}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(smokeRequestTimeoutMs),
      });

    const health = await request("/healthz");
    const healthBody = await health.json();

    if (!health.ok || previewRecord(healthBody)["environment"] !== "prod") {
      throw new Error("Production health failed");
    }

    const readiness = await request("/readyz");

    if (!readiness.ok) {
      throw new Error("Production readiness failed");
    }

    const specification = await request("/openapi.json");
    const specificationBody = await specification.json();

    if (!specification.ok || typeof previewRecord(specificationBody)["openapi"] !== "string") {
      throw new Error("Production API contract unavailable");
    }

    const unauthorized = await request("/api/v1/notes/unauthenticated-check");

    if (unauthorized.status !== httpUnauthorized) {
      throw new Error("Production authentication boundary failed");
    }

    const preflight = await fetch(`${urls.api}/api/v1/notes`, {
      method: "OPTIONS",
      headers: {
        Origin: urls.frontend,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
      redirect: "error",
      signal: AbortSignal.timeout(smokeRequestTimeoutMs),
    });

    if (
      !preflight.ok ||
      preflight.headers.get("access-control-allow-origin") !== urls.frontend ||
      preflight.headers.get("access-control-allow-credentials") !== "true"
    ) {
      throw new Error("Production exact-origin CORS failed");
    }

    const deniedOrigin = await fetch(`${urls.api}/api/v1/notes`, {
      method: "OPTIONS",
      headers: { Origin: "https://untrusted.invalid", "Access-Control-Request-Method": "POST" },
      redirect: "error",
      signal: AbortSignal.timeout(smokeRequestTimeoutMs),
    });

    if (deniedOrigin.headers.get("access-control-allow-origin") !== null) {
      throw new Error("Production foreign-origin CORS admitted");
    }

    if (app === "frontend" || app === "all") {
      await verifyProductionFrontend(urls);
    }
  }).pipe(Effect.retry({ times: smokePropagationRetries, schedule: Schedule.spaced("3 seconds") }));
