import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { TemporalEnvironmentSchema } from "./temporal_configuration.js";
import { createTemporalConnectionOptions } from "../adapters/workflows/temporal_connection_options.js";
import { createPortableS3Client } from "../adapters/storage/s3_client.js";

test("Temporal security rejects downgrade and incomplete credentials without disclosing secrets", () => {
  for (const temporalSecurity of [
    { tls: false, apiKey: "private-value" },
    { tls: false, serverCa: "private-value" },
    { clientCert: "private-value" },
    { clientKey: "private-value" },
  ]) {
    assert.throws(
      () =>
        createTemporalConnectionOptions({ temporalAddress: "localhost:7233", temporalSecurity }),
      /^Error: Temporal security configuration invalid$/u,
    );
  }

  for (const values of [
    { TEMPORAL_TLS: "yes" },
    { TEMPORAL_TLS: "false", TEMPORAL_API_KEY: "private-value" },
    { TEMPORAL_TLS_CLIENT_CERT_DATA: "private-value" },
    { TEMPORAL_API_KEY: " " },
  ]) {
    const parsed = TemporalEnvironmentSchema.safeParse(values);
    assert.equal(parsed.success, false);
  }
});

for (const forcePathStyle of [true, false]) {
  test(
    `S3 wire signs configured region with path style ${String(forcePathStyle)}`,
    {
      skip: !forcePathStyle && process.env["PLATFORM_PROVIDER_WIRE"] !== "1",
      timeout: 5000,
    },
    async () => {
      let requestPath = "";
      let requestHost = "";
      let authorization = "";

      const server = createServer((request, response) => {
        requestPath = request.url ?? "";
        requestHost = request.headers.host ?? "";
        authorization = request.headers.authorization ?? "";
        request.resume();
        response.end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const address = server.address();

      if (address === null || typeof address === "string") {
        throw new Error("S3 wire test has no TCP address");
      }

      const client = createPortableS3Client({
        s3Endpoint: `http://localhost:${String(address.port)}`,
        s3AccessKeyId: "wire-access",
        s3SecretAccessKey: "wire-secret",
        s3Region: "eu-west-2",
        s3ForcePathStyle: forcePathStyle,
      });

      try {
        await client.send(new PutObjectCommand({ Bucket: "wire", Key: "note.txt", Body: "note" }), {
          abortSignal: AbortSignal.timeout(2000),
        });

        assert.match(authorization, /\/eu-west-2\/s3\/aws4_request/u);
        assert.equal(requestPath.split("?")[0], forcePathStyle ? "/wire/note.txt" : "/note.txt");

        assert.equal(
          requestHost,
          `${forcePathStyle ? "localhost" : "wire.localhost"}:${String(address.port)}`,
        );
      } finally {
        client.destroy();
        server.closeAllConnections();

        const closed = once(server, "close");

        server.close();
        await closed;
      }
    },
  );
}
