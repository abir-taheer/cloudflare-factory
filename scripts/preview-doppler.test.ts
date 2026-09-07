import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Effect } from "effect";
import { loadDeploymentDoppler, parseDeploymentRuntime } from "./preview-doppler.ts";

test("runtime projection excludes management secrets and preview baseline authentication", () => {
  const config = { ENVIRONMENT: "preview", API_TOKEN: "baseline-secret", ACCOUNT_ID: "foreign", PREVIEW_AUTH_SEED: "private" };
  for (const app of ["api", "frontend", "workflows"] as const) {
    assert.deepEqual(parseDeploymentRuntime(config, "preview", app), { vars: { ENVIRONMENT: "preview" }, secrets: {} });
  }
  assert.throws(() => parseDeploymentRuntime(config, "prod", "api"));
  assert.throws(() => parseDeploymentRuntime({ ENVIRONMENT: "prod", API_TOKEN: "short" }, "prod", "api"));
  assert.deepEqual(parseDeploymentRuntime({ ENVIRONMENT: "prod", API_TOKEN: "synthetic-production-token" }, "prod", "api"), {
    vars: { ENVIRONMENT: "prod" }, secrets: { API_TOKEN: "synthetic-production-token" },
  });
});

test("Doppler rejects a token for another project or environment without leaking its response", async () => {
  const priorToken = process.env["DOPPLER_API_TOKEN"];
  const priorProject = process.env["DOPPLER_API_PROJECT"];
  process.env["DOPPLER_API_TOKEN"] = "synthetic-service-token";
  process.env["DOPPLER_API_PROJECT"] = "factory-api";
  let config = { DOPPLER_PROJECT: "factory-ci", DOPPLER_CONFIG: "preview" };
  const mockedFetch = mock.method(globalThis, "fetch", () => Promise.resolve(Response.json(config)));
  try {
    await assert.rejects(Effect.runPromise(loadDeploymentDoppler("API", "preview")), /Deployment Doppler scope verification failed/u);
    config = { DOPPLER_PROJECT: "factory-api", DOPPLER_CONFIG: "prod" };
    await assert.rejects(Effect.runPromise(loadDeploymentDoppler("API", "preview")), /Deployment Doppler scope verification failed/u);
    config = { DOPPLER_PROJECT: "factory-api", DOPPLER_CONFIG: "preview" };
    assert.deepEqual(await Effect.runPromise(loadDeploymentDoppler("API", "preview")), config);
  } finally {
    mockedFetch.mock.restore();
    if (priorToken === undefined) delete process.env["DOPPLER_API_TOKEN"]; else process.env["DOPPLER_API_TOKEN"] = priorToken;
    if (priorProject === undefined) delete process.env["DOPPLER_API_PROJECT"]; else process.env["DOPPLER_API_PROJECT"] = priorProject;
  }
});
