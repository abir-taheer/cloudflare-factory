import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Effect } from "effect";
import { loadDeploymentDoppler, parseDeploymentRuntime } from "./deployment-doppler.ts";

test("production email projection requires the real Cloudflare adapter and keeps controller keys private", () => {
  const config = {
    ENVIRONMENT: "prod",
    API_URL: "https://api.example.test",
    FRONTEND_ORIGINS: "https://app.example.test",
    EMAIL_DELIVERY: "cloudflare",
    EMAIL_FROM: "auth@example.test",
    BETTER_AUTH_SECRET: "synthetic-session-secret-at-least-32",
    CLOUDFLARE_API_TOKEN: "private-controller-token",
  };

  const runtime = parseDeploymentRuntime(config, "prod", "api");

  assert.partialDeepStrictEqual(runtime.vars, {
    EMAIL_DELIVERY: "cloudflare",
    EMAIL_FROM: config.EMAIL_FROM,
  });

  assert.deepEqual(Object.keys(runtime.secrets), ["BETTER_AUTH_SECRET"]);
  assert.equal(JSON.stringify(runtime).includes(config.CLOUDFLARE_API_TOKEN), false);

  for (const delivery of ["capture", "smtp", "", undefined]) {
    assert.throws(() =>
      parseDeploymentRuntime({ ...config, EMAIL_DELIVERY: delivery }, "prod", "api"),
    );
  }

  assert.throws(() => parseDeploymentRuntime({ ...config, EMAIL_FROM: "invalid" }, "prod", "api"));

  assert.equal(
    parseDeploymentRuntime(config, "prod", "frontend").vars["EMAIL_DELIVERY"],
    undefined,
  );
});

test("runtime projection isolates session secrets to the API and excludes management credentials", () => {
  const config = {
    ENVIRONMENT: "preview",
    BETTER_AUTH_SECRET: "synthetic-session-secret-at-least-32",
    EMAIL_FROM: "test@example.test",
    ACCOUNT_ID: "foreign",
    NEON_API_KEY: "private",
  };

  for (const app of ["frontend", "workflows"] as const) {
    assert.deepEqual(parseDeploymentRuntime(config, "preview", app), {
      vars: { ENVIRONMENT: "preview" },
      secrets: {},
    });
  }

  assert.deepEqual(parseDeploymentRuntime(config, "preview", "api"), {
    vars: { ENVIRONMENT: "preview", EMAIL_FROM: "test@example.test" },
    secrets: { BETTER_AUTH_SECRET: "synthetic-session-secret-at-least-32" },
  });

  assert.throws(() => parseDeploymentRuntime(config, "prod", "api"));

  assert.throws(() =>
    parseDeploymentRuntime(
      { ENVIRONMENT: "preview", BETTER_AUTH_SECRET: "short" },
      "preview",
      "api",
    ),
  );
});

test("Doppler rejects a token for another project or environment without leaking its response", async () => {
  const priorToken = process.env["DOPPLER_API_TOKEN"];
  const priorProject = process.env["DOPPLER_API_PROJECT"];

  process.env["DOPPLER_API_TOKEN"] = "synthetic-service-token";
  process.env["DOPPLER_API_PROJECT"] = "factory-api";

  let config = { DOPPLER_PROJECT: "factory-ci", DOPPLER_CONFIG: "preview" };

  const mockedFetch = mock.method(globalThis, "fetch", () =>
    Promise.resolve(Response.json(config)),
  );

  try {
    await assert.rejects(Effect.runPromise(loadDeploymentDoppler("API", "preview")), {
      operation: "Deployment Doppler scope verification failed",
    });

    config = { DOPPLER_PROJECT: "factory-api", DOPPLER_CONFIG: "prod" };

    await assert.rejects(Effect.runPromise(loadDeploymentDoppler("API", "preview")), {
      operation: "Deployment Doppler scope verification failed",
    });

    config = { DOPPLER_PROJECT: "factory-api", DOPPLER_CONFIG: "preview" };

    const loaded = await Effect.runPromise(loadDeploymentDoppler("API", "preview"));
    assert.deepEqual(loaded, config);
  } finally {
    mockedFetch.mock.restore();

    if (priorToken === undefined) {
      delete process.env["DOPPLER_API_TOKEN"];
    } else {
      process.env["DOPPLER_API_TOKEN"] = priorToken;
    }

    if (priorProject === undefined) {
      delete process.env["DOPPLER_API_PROJECT"];
    } else {
      process.env["DOPPLER_API_PROJECT"] = priorProject;
    }
  }
});
