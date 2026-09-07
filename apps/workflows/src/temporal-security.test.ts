import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { type ServerHttp2Session, createSecureServer } from "node:http2";
import test from "node:test";
import { Connection } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { createTemporalConnectionOptions } from "@factory/platform/portable";

const fixtureDirectory = process.env["PROVIDER_TLS_FIXTURE_DIR"];
const grpcFrameHeaderBytes = 5;
const connectionTimeoutMs = 1000;

async function createTemporalTlsPeer(directory: string) {
  const [ca, cert, key] = await Promise.all([
    readFile(`${directory}/ca.pem`, "utf8"),
    readFile(`${directory}/cert.pem`, "utf8"),
    readFile(`${directory}/key.pem`, "utf8"),
  ]);

  const sessions = new Set<ServerHttp2Session>();
  let authenticatedRequests = 0;
  const server = createSecureServer({ ca, cert, key, requestCert: true, rejectUnauthorized: true });

  server.on("session", (session) => {
    sessions.add(session);

    session.on("error", () => {
      /* Negative TLS cases close the connection. */
    });

    session.on("close", () => {
      sessions.delete(session);
    });
  });

  server.on("stream", (stream, headers) => {
    stream.on("error", () => {
      /* Rejected clients may cancel their RPC. */
    });

    const authenticated = headers.authorization === "Bearer wire-token";

    const systemInfo =
      headers[":path"] === "/temporal.api.workflowservice.v1.WorkflowService/GetSystemInfo";

    if (authenticated && systemInfo) {
      authenticatedRequests += 1;
    }

    stream.respond(
      { ":status": 200, "content-type": "application/grpc" },
      { waitForTrailers: true },
    );

    stream.on("wantTrailers", () => {
      stream.sendTrailers({ "grpc-status": authenticated && systemInfo ? "0" : "16" });
    });

    stream.resume();
    // GetSystemInfo has an empty protobuf response when no optional capabilities are advertised.
    stream.end(new Uint8Array(grpcFrameHeaderBytes));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Temporal TLS peer has no TCP address");
  }

  return {
    address: `127.0.0.1:${String(address.port)}`,
    security: {
      apiKey: "wire-token",
      serverCa: ca,
      clientCert: cert,
      clientKey: key,
      serverName: "temporal.test",
    },
    authenticatedRequests: () => authenticatedRequests,
    close: async () => {
      for (const session of sessions) {
        session.destroy();
      }

      const closed = once(server, "close");

      server.close();
      await closed;
    },
  };
}

test(
  "Temporal client and worker use verified mTLS, SNI and API keys on the wire",
  {
    skip: fixtureDirectory === undefined,
    timeout: 15_000,
  },
  async () => {
    assert.notEqual(fixtureDirectory, undefined);

    if (fixtureDirectory === undefined) {
      throw new Error("Temporal TLS fixture directory missing");
    }

    const peer = await createTemporalTlsPeer(fixtureDirectory);

    try {
      const options = createTemporalConnectionOptions({
        temporalAddress: peer.address,
        temporalSecurity: peer.security,
      });

      const client = await Connection.connect({ ...options, connectTimeout: connectionTimeoutMs });
      await client.close();

      const worker = await NativeConnection.connect(options);

      await worker.close();
      assert.equal(peer.authenticatedRequests(), 2);

      const rejectedSecurity = [
        { ...peer.security, apiKey: "wrong-token" },
        { ...peer.security, serverName: "wrong.test" },
        { ...peer.security, serverCa: undefined },
        { ...peer.security, clientCert: undefined, clientKey: undefined },
      ];

      await Promise.all(
        rejectedSecurity.map(async (security) => {
          const rejectedOptions = createTemporalConnectionOptions({
            temporalAddress: peer.address,
            temporalSecurity: security,
          });

          await assert.rejects(async () => {
            const unexpectedClient = await Connection.connect({
              ...rejectedOptions,
              connectTimeout: connectionTimeoutMs,
            });

            await unexpectedClient.close();
          });

          await assert.rejects(async () => {
            const unexpectedWorker = await NativeConnection.connect(rejectedOptions);
            await unexpectedWorker.close();
          });
        }),
      );

      assert.equal(peer.authenticatedRequests(), 2);
    } finally {
      await peer.close();
    }
  },
);
