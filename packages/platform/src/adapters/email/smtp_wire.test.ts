import assert from "node:assert/strict";
import test from "node:test";
import { createPortableSmtpTransport } from "./smtp_transport.js";
import { type Socket, createServer } from "node:net";
import { once } from "node:events";

const smtpHandshakeTimeoutMs = 1000;

function respondToSmtpCommand(socket: Socket, line: string, observeAuthentication: () => void) {
  const command = line.split(" ")[0] ?? "";

  switch (command) {
    case "EHLO": {
      socket.write("250-test\r\n250 AUTH PLAIN\r\n");
      break;
    }
    case "AUTH": {
      observeAuthentication();
      socket.write("235 authenticated\r\n");
      break;
    }
    case "STARTTLS": {
      socket.write("502 unavailable\r\n");
      break;
    }
    case "QUIT": {
      socket.end("221 bye\r\n");
      break;
    }
    default: {
      socket.write("250 ok\r\n");
    }
  }
}

/** Adversarial real TCP peer advertises AUTH without STARTTLS and records no credential contents. */
async function createPlaintextSmtpPeer() {
  let authenticationSeen = false;
  const sockets = new Set<Socket>();

  const observeAuthentication = () => {
    authenticationSeen = true;
  };

  const server = createServer((socket) => {
    sockets.add(socket);

    socket.setTimeout(smtpHandshakeTimeoutMs, () => {
      socket.destroy();
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });

    socket.write("220 test SMTP\r\n");

    let pending = "";

    socket.on("data", (chunk: Uint8Array) => {
      pending += new TextDecoder().decode(chunk);

      let lineEnd = pending.indexOf("\r\n");

      while (lineEnd >= 0) {
        const line = pending.slice(0, lineEnd);

        pending = pending.slice(lineEnd + "\r\n".length);
        respondToSmtpCommand(socket, line, observeAuthentication);
        lineEnd = pending.indexOf("\r\n");
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("SMTP test peer has no TCP address");
  }

  return {
    port: address.port,
    authenticationSeen: () => authenticationSeen,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      const closed = once(server, "close");

      server.close();
      await closed;
    },
  };
}

test("direct SMTP transport rejects authenticated plaintext before creating a transport", () => {
  const config = {
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpAuth: { user: "test-user", pass: "private-value" },
  };

  assert.throws(() => createPortableSmtpTransport(config), /authentication requires TLS/u);

  assert.throws(
    () => createPortableSmtpTransport({ ...config, smtpSecure: false, smtpRequireTls: false }),
    /authentication requires TLS/u,
  );
});

const wireAuthentication = { user: "wire-user", pass: "wire-password" };

const wireCases = [
  { name: "omitted TLS", options: { smtpAuth: wireAuthentication }, success: false },
  {
    name: "disabled TLS",
    options: { smtpAuth: wireAuthentication, smtpSecure: false, smtpRequireTls: false },
    success: false,
  },
  {
    name: "unavailable STARTTLS",
    options: { smtpAuth: wireAuthentication, smtpRequireTls: true },
    success: false,
  },
  { name: "unauthenticated relay", options: {}, success: true },
];

for (const scenario of wireCases) {
  test(
    `SMTP wire never sends credentials over plaintext: ${scenario.name}`,
    { timeout: 5000 },
    async () => {
      const peer = await createPlaintextSmtpPeer();
      let succeeded = false;
      let transport: ReturnType<typeof createPortableSmtpTransport> | null = null;

      try {
        transport = createPortableSmtpTransport({
          smtpHost: "127.0.0.1",
          smtpPort: peer.port,
          ...scenario.options,
        });

        succeeded = await transport.verify();
      } catch {
        succeeded = false;
      } finally {
        transport?.close();
        await peer.close();
      }

      assert.equal(succeeded, scenario.success);
      assert.equal(peer.authenticationSeen(), false);
    },
  );
}
