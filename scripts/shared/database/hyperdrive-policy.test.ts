import assert from "node:assert/strict";
import test from "node:test";
import { verifyHyperdriveConnectionPolicy } from "./hyperdrive-policy.ts";

const providerConfiguration = {
  id: "synthetic-hyperdrive",
  caching: { disabled: true },
  mtls: { sslmode: "require" },
  origin_connection_limit: 5,
};

test("Hyperdrive readback accepts public certificate verification with uncached bounded connections", () => {
  assert.doesNotThrow(() => {
    verifyHyperdriveConnectionPolicy(providerConfiguration);
  });
});

test("Hyperdrive readback rejects missing TLS policy, custom trust drift, caching and pool changes", () => {
  for (const changed of [
    { mtls: undefined },
    { mtls: { sslmode: "disable" } },
    { mtls: { sslmode: "verify-full" } },
    { mtls: { sslmode: "require", ca_certificate_id: "unexpected-ca" } },
    { mtls: { sslmode: "require", mtls_certificate_id: "unexpected-client" } },
    { caching: { disabled: false } },
    { origin_connection_limit: 60 },
  ]) {
    assert.throws(() => {
      verifyHyperdriveConnectionPolicy({ ...providerConfiguration, ...changed });
    }, /Hyperdrive connection policy drift/u);
  }
});
