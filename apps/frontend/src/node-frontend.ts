import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pathToFileURL } from "node:url";
import { ConfigProvider, Effect } from "effect";
import { handleFrontendRequest } from "./frontend-http.js";
import { parseNodeFrontendConfiguration } from "./frontend-configuration.js";

const badRequestStatus = 400;

/** Portable production server serves only built assets and public runtime configuration. */
export function createFrontendServer(assetRoot = new URL("../dist/", import.meta.url)) {
  return createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    const respond = Effect.tryPromise(async () => {
      const target = incoming.url ?? "/";

      if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
        outgoing.writeHead(badRequestStatus);
        outgoing.end();
        return;
      }

      const response = await Effect.runPromise(
        handleFrontendRequest(
          new Request(`http://frontend${target}`, { method: incoming.method ?? "GET" }),
          {
            fetchAsset: async (request) => {
              const path = new URL(request.url).pathname;
              const content = await readFile(new URL(path.slice(1), assetRoot));
              let contentType = "text/html";

              if (path.endsWith(".js")) {
                contentType = "text/javascript";
              }

              if (path.endsWith(".css")) {
                contentType = "text/css";
              }

              if (path.endsWith(".json")) {
                contentType = "application/json";
              }

              return new Response(request.method === "HEAD" ? null : content, {
                headers: { "Content-Type": `${contentType}; charset=utf-8` },
              });
            },
          },
        ),
      );

      outgoing.writeHead(response.status, Object.fromEntries(response.headers));

      if (response.body === null) {
        outgoing.end();
        return;
      }

      // eslint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion, factory/no-type-casts -- Node and Workers declare the same native Web stream with different reader overloads.
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), outgoing);
    });

    Effect.runFork(
      respond.pipe(
        Effect.orElseSucceed(() => {
          outgoing.destroy();
        }),
      ),
    );
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuration = Effect.runSync(parseNodeFrontendConfiguration(ConfigProvider.fromEnv()));
  const server = createFrontendServer();
  server.listen(configuration.PORT, "0.0.0.0");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close();
      server.closeAllConnections();
    });
  }
}
