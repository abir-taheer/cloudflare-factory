import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { catch as catchFrontendFailure } from "effect/Effect";
import { handleFrontendRequest, secureFrontendResponse } from "./frontend-http.js";
import { parseFrontendApiOrigin, readNodeFrontendConfiguration } from "./frontend-configuration.js";

/** Create a portable frontend HTTP server; API_URL must be an explicit HTTP origin. */
export function createFrontendServer(apiUrl: string) {
  const apiOrigin = parseFrontendApiOrigin(apiUrl);
  return createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    const serveRequest = Effect.tryPromise(async () => {
      if (incoming.url === undefined || !incoming.url.startsWith("/") || incoming.url.startsWith("//") || incoming.url.includes("\\")) {
        return secureFrontendResponse(new Response("Invalid request target", { status: 400 }));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const method = incoming.method ?? "GET";
      const init: RequestInit & { duplex: "half" } = { method, headers, duplex: "half" };
      if (method !== "GET" && method !== "HEAD") {
        // Node's byte stream is a Web stream at runtime; mixed Workers/DOM declarations differ structurally.
        // eslint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- This is the Node HTTP byte-stream boundary, never application data.
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      }
      return handleFrontendRequest(new Request(`http://frontend${incoming.url}`, init), {
        fetchApi: (request) => fetch(new Request(new URL(new URL(request.url).pathname, apiOrigin), request)),
        fetchAsset: async (request) => {
          const path = new URL(request.url).pathname;
          const filename = path === "/" ? "index.html" : path.slice(1);
          let contentType = "text/html";
          if (filename.endsWith(".js")) contentType = "text/javascript";
          if (filename.endsWith(".css")) contentType = "text/css";
          const content = await readFile(new URL(`../public/${filename}`, import.meta.url));
          return new Response(request.method === "HEAD" ? null : content, { headers: { "Content-Type": `${contentType}; charset=utf-8` } });
        }
      });
    }).pipe(catchFrontendFailure(() => Effect.succeed(secureFrontendResponse(new Response("Frontend request failed", { status: 502 })))));
    const sendResponse = serveRequest.pipe(Effect.flatMap((response) => Effect.tryPromise(async () => {
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      // Node fetch returns a native Web stream; Workers' ambient declaration omits Node's reader overloads.
      // eslint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- Narrow bridge between equivalent runtime Web streams.
      const stream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
      await pipeline(stream, outgoing);
    })));
    Effect.runFork(sendResponse.pipe(catchFrontendFailure(() => Effect.sync(() => { outgoing.destroy(); }))));
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuration = readNodeFrontendConfiguration();
  const server = createFrontendServer(configuration.API_URL);
  server.listen(configuration.PORT, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
