import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect } from "effect";
import { parseApiConfiguration } from "./api-configuration.js";
import { parsePortableConfiguration } from "@factory/platform/configuration";

const portableEnvironment = {
  ENVIRONMENT: "dev",
  DATABASE_URL: "postgres://factory:secret@postgres:5432/factory",
  REDIS_URL: "redis://redis:6379",
  S3_ENDPOINT: "http://minio:9000",
  S3_ACCESS_KEY_ID: "test-access",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET: "factory",
  SMTP_HOST: "mailpit",
  SMTP_PORT: "1025",
  TEMPORAL_ADDRESS: "temporal:7233",
  TEMPORAL_NAMESPACE: "default",
  TEMPORAL_TASK_QUEUE: "factory-notes",
  PLATFORM_NAMESPACE: "factory",
};

const apiEnvironment = {
  ENVIRONMENT: "dev",
  API_URL: "http://localhost:8787",
  FRONTEND_ORIGINS: "http://localhost:5174",
  BETTER_AUTH_SECRET: "synthetic-authentication-secret-for-validation",
  EMAIL_FROM: "auth@example.test",
  EMAIL_DELIVERY: "smtp",
};

test("API configuration accepts explicit auth settings and isolated email delivery", () => {
  const settings = [
    { ENVIRONMENT: "dev", EMAIL_DELIVERY: "smtp" },
    { ENVIRONMENT: "preview", EMAIL_DELIVERY: "capture" },
    { ENVIRONMENT: "prod", EMAIL_DELIVERY: "cloudflare" },
    { ENVIRONMENT: "prod", EMAIL_DELIVERY: "smtp" },
  ];

  for (const setting of settings) {
    const parsed = Effect.runSync(
      parseApiConfiguration(ConfigProvider.fromEnvRecord({ ...apiEnvironment, ...setting })),
    );

    assert.partialDeepStrictEqual(parsed, {
      environment: setting.ENVIRONMENT,
      emailDelivery: setting.EMAIL_DELIVERY,
      apiUrl: apiEnvironment.API_URL,
      frontendOrigins: [apiEnvironment.FRONTEND_ORIGINS],
      emailFrom: apiEnvironment.EMAIL_FROM,
    });
  }
});

test("API configuration rejects malformed origins, missing auth settings and unsafe capture without disclosing inputs", () => {
  const invalidSettings = [
    { ENVIRONMENT: "local" },
    { ENVIRONMENT: "prod", EMAIL_DELIVERY: "capture" },
    { ENVIRONMENT: "dev", EMAIL_DELIVERY: "capture" },
    { API_URL: "https://user:sensitive-value@example.test" },
    { API_URL: "https://example.test/path" },
    { API_URL: "https://example.test?token=sensitive-value" },
    { FRONTEND_ORIGINS: "*" },
    { FRONTEND_ORIGINS: "https://*.example.test" },
    { FRONTEND_ORIGINS: "https://example.test/path" },
    { FRONTEND_ORIGINS: "" },
    { BETTER_AUTH_SECRET: "sensitive-value" },
    { BETTER_AUTH_SECRET: "" },
    { EMAIL_FROM: "invalid" },
    { EMAIL_DELIVERY: "" },
  ];

  for (const setting of invalidSettings) {
    const error = Effect.runSync(
      parseApiConfiguration(ConfigProvider.fromEnvRecord({ ...apiEnvironment, ...setting })).pipe(
        Effect.flip,
      ),
    );

    assert.ok(error instanceof Error);
    assert.doesNotMatch(String(error), /sensitive-value/u);
  }

  for (const key of Object.keys(apiEnvironment)) {
    const values = Object.fromEntries(
      Object.entries(apiEnvironment).filter(([name]) => name !== key),
    );

    const error = Effect.runSync(
      parseApiConfiguration(ConfigProvider.fromEnvRecord(values)).pipe(Effect.flip),
    );

    assert.ok(error instanceof Error);
  }
});

test("portable boundary parses numeric ports and explicit isolated namespaces", () => {
  const parsed = Effect.runSync(
    parsePortableConfiguration(ConfigProvider.fromEnvRecord(portableEnvironment)),
  );

  assert.partialDeepStrictEqual(parsed, {
    smtpPort: 1025,
    namespace: "factory",
    temporalNamespace: "default",
    taskQueue: "factory-notes",
  });
});

test("portable boundary rejects invalid endpoints, missing isolation and malformed ports before connecting", () => {
  const invalidSettings = [
    { DATABASE_URL: "https://postgres/factory" },
    { REDIS_URL: "file:///redis" },
    { S3_ENDPOINT: "http://username:secret@minio:9000" },
    { S3_ENDPOINT: "http://minio:9000?secret=hidden" },
    { SMTP_PORT: "0" },
    { SMTP_PORT: "65536" },
    { SMTP_PORT: "1.5" },
    { SMTP_PORT: "abc" },
    { SMTP_SECURE: "yes" },
    { SMTP_REQUIRE_TLS: "1" },
    { SMTP_USERNAME: "user" },
    { SMTP_PASSWORD: "secret" },
    { SMTP_USERNAME: "", SMTP_PASSWORD: "secret" },
    { SMTP_USERNAME: "user", SMTP_PASSWORD: "secret" },
    {
      SMTP_USERNAME: "user",
      SMTP_PASSWORD: "secret",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false",
    },
    { TEMPORAL_ADDRESS: "temporal" },
    { TEMPORAL_NAMESPACE: "" },
    { TEMPORAL_TASK_QUEUE: "" },
    { PLATFORM_NAMESPACE: "" },
    { S3_SECRET_ACCESS_KEY: "" },
    { ENVIRONMENT: "local" },
  ];

  for (const invalidSetting of invalidSettings) {
    assert.throws(
      () =>
        Effect.runSync(
          parsePortableConfiguration(
            ConfigProvider.fromEnvRecord({ ...portableEnvironment, ...invalidSetting }),
          ),
        ),
      /Invalid portable environment/u,
    );
  }
});

test("portable SMTP supports authenticated STARTTLS and implicit TLS without exposing invalid credentials", () => {
  for (const secure of ["true", "false"]) {
    const parsed = Effect.runSync(
      parsePortableConfiguration(
        ConfigProvider.fromEnvRecord({
          ...portableEnvironment,
          SMTP_SECURE: secure,
          SMTP_REQUIRE_TLS: "true",
          SMTP_USERNAME: "smtp-user",
          SMTP_PASSWORD: "smtp-password",
        }),
      ),
    );

    assert.partialDeepStrictEqual(parsed, {
      smtpSecure: secure === "true",
      smtpRequireTls: true,
      smtpAuth: { user: "smtp-user", pass: "smtp-password" },
    });
  }

  const rejected = Effect.runSync(
    parsePortableConfiguration(
      ConfigProvider.fromEnvRecord({ ...portableEnvironment, SMTP_PASSWORD: "private-value" }),
    ).pipe(Effect.flip),
  );

  assert.doesNotMatch(String(rejected), /private-value/u);
});
