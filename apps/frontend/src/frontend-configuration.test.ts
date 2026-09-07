import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect } from "effect";
import { parseFrontendScalars, parseNodeFrontendConfiguration } from "./frontend-configuration.js";
import cloudflareFrontend from "./cloudflare-frontend.js";

const nodeEnvironment = { ENVIRONMENT: "dev", API_URL: "http://api:8787", PORT: "5173" };

test("frontend configuration accepts the same keys for dev preview and prod", () => {
  for (const environment of ["dev", "preview", "prod"]) {
    const configuration = Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnvRecord({ ...nodeEnvironment, ENVIRONMENT: environment })));
    assert.deepEqual(configuration, { ENVIRONMENT: environment, API_URL: "http://api:8787", PORT: 5173 });
    assert.deepEqual(Effect.runSync(parseFrontendScalars(ConfigProvider.fromUnknown({ ENVIRONMENT: environment }))), { ENVIRONMENT: environment });
  }
});

test("frontend configuration rejects missing settings and unsupported environment names", () => {
  for (const environment of [undefined, "", "local", "staging", "production", 42]) {
    assert.throws(() => Effect.runSync(parseFrontendScalars(ConfigProvider.fromUnknown({ ENVIRONMENT: environment }))), /Invalid frontend environment/u);
  }
  for (const input of [{}, { ENVIRONMENT: "dev" }, { ENVIRONMENT: "dev", API_URL: "http://api:8787" }, { ENVIRONMENT: "dev", PORT: "5173" }]) {
    assert.throws(() => Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnvRecord(input))), /Invalid frontend environment/u);
  }
});

test("frontend configuration rejects invalid ports and unsafe origins without echoing values", () => {
  for (const port of ["", "0", "65536", "1.5", "NaN", "-1", "abc"]) {
    assert.throws(() => Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnvRecord({ ...nodeEnvironment, PORT: port }))), /Invalid frontend environment/u);
  }
  for (const origin of ["", "file:///tmp", "https://user:private-secret@example.com", "https://example.com/path", "https://example.com?token=private-secret", "https://example.com#private-secret", " http://api:8787"]) {
    const error = Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnvRecord({ ...nodeEnvironment, API_URL: origin })).pipe(Effect.flip));
    assert.match(error.message, /Invalid frontend environment/u);
    assert.equal(error.message.includes("private-secret"), false);
  }
});

test("Cloudflare rejects invalid scalar configuration before API or asset access", async () => {
  const responses = await Promise.all(["/", "/healthz"].map((path) => cloudflareFrontend.fetch(new Request(`https://frontend.example${path}`), {
    ENVIRONMENT: "staging",
    API: { fetch: () => { throw new Error("API binding must not be reached"); } },
    ASSETS: { fetch: () => { throw new Error("Asset binding must not be reached"); } }
  })));
  assert.deepEqual(responses.map((response) => response.status), [503, 503]);
  assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ["Frontend service not configured", "Frontend service not configured"]);
  assert.ok(responses.every((response) => response.headers.get("x-content-type-options") === "nosniff"));
});
