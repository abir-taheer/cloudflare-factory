import assert from "node:assert/strict";
import test from "node:test";
import { validateDevelopmentConfiguration } from "./development-configuration.ts";

const projects = ["fixture-api", "fixture-frontend", "fixture-workflows", "fixture-executor"];

const baseline = {
  services: {
    api: {
      environment: {
        ENVIRONMENT: "dev",
        DATABASE_URL: "postgres://database/local",
        BETTER_AUTH_SECRET: "original",
        EMAIL_FROM: "local@example.test",
      },
    },
    frontend: { environment: { ENVIRONMENT: "dev", VITE_API_URL: "http://localhost:8787" } },
    workflows: { environment: { ENVIRONMENT: "dev", DATABASE_URL: "postgres://database/local" } },
    executor: { environment: { ENVIRONMENT: "dev", EXECUTOR_TOKEN: "original" } },
    infrastructure: {},
  },
};

const createDevelopmentFixture = () => ({
  services: Object.fromEntries(
    Object.entries(baseline.services).map(([app, service], index) => [
      app,
      {
        environment: {
          ...("environment" in service ? service.environment : {}),
          DOPPLER_PROJECT: projects[index],
          DOPPLER_CONFIG: "dev",
          DOPPLER_ENVIRONMENT: "dev",
          ...(app === "api" ? { BETTER_AUTH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } : {}),
          ...(app === "executor" ? { EXECUTOR_TOKEN: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } : {}),
        },
      },
    ]),
  ),
});

const getDownloadedSettings = (config: ReturnType<typeof createDevelopmentFixture>) =>
  Object.fromEntries(
    Object.entries(config.services).map(([app, service]) => [app, service.environment]),
  );

test("development app settings remain isolated and match Docker migration providers", () => {
  const config = createDevelopmentFixture();

  delete config.services["infrastructure"];

  assert.doesNotThrow(() => {
    validateDevelopmentConfiguration(baseline, config, projects, getDownloadedSettings(config));
  });

  for (const [app, key, value] of [
    ["api", "DATABASE_URL", "postgres://external.example.test/other"],
    ["workflows", "DATABASE_URL", "postgres://database/other"],
    ["frontend", "BETTER_AUTH_SECRET", "unwanted"],
    ["api", "NODE_OPTIONS", "--inspect"],
    ["api", "DOPPLER_TOKEN", "unwanted"],
    ["executor", "DOPPLER_CONFIG", "prod"],
    ["api", "DOPPLER_PROJECT", "fixture-ci"],
    ["api", "BETTER_AUTH_SECRET", "short"],
    ["api", "BETTER_AUTH_SECRET", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$"],
  ] as const) {
    const invalid = structuredClone(config);
    const service = invalid.services[app];

    assert.ok(service);
    Object.assign(service.environment, { [key]: value });

    assert.throws(() => {
      validateDevelopmentConfiguration(baseline, invalid, projects, getDownloadedSettings(invalid));
    });
  }

  assert.throws(() => {
    validateDevelopmentConfiguration(
      baseline,
      config,
      projects.map(() => "same"),
      getDownloadedSettings(config),
    );
  });

  assert.throws(() => {
    validateDevelopmentConfiguration(baseline, {}, projects, getDownloadedSettings(config));
  });
});

test("development rejects dotenv interpolation and rotation against official JSON values", () => {
  const config = createDevelopmentFixture();

  delete config.services["infrastructure"];

  const original = structuredClone(getDownloadedSettings(config));
  const api = original["api"];

  assert.ok(api);

  Object.assign(api, {
    BETTER_AUTH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$EXPANDED",
  });

  assert.throws(() => {
    validateDevelopmentConfiguration(baseline, config, projects, original);
  });
});
