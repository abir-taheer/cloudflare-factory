import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicOpenApiSchema } from "./public_openapi.js";

const document = {
  openapi: "3.1.0",
  info: { title: "Public API", version: "1.0.0", description: "Preserve public metadata" },
  paths: { "/healthz": { get: { responses: { "200": { description: "Healthy" } } } } },
  components: {
    schemas: {},
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "session" } },
  },
};

test("public document validation preserves valid extension and schema fields", () => {
  assert.deepEqual(PublicOpenApiSchema.parse(document), document);
});

test("deployment server overrides are rejected at every OpenAPI operation boundary", () => {
  const servers = [{ url: "https://deployment.example.test" }];
  const root = PublicOpenApiSchema.safeParse({ ...document, servers });
  const path = PublicOpenApiSchema.safeParse({ ...document, paths: { "/healthz": { servers } } });

  const operation = PublicOpenApiSchema.safeParse({
    ...document,
    paths: { "/healthz": { get: { servers } } },
  });

  assert.equal(root.success, false);
  assert.equal(path.success, false);
  assert.equal(operation.success, false);
});
