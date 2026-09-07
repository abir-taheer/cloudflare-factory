import { Effect } from "effect";
import { catch as catchFrontendFailure } from "effect/Effect";

/** Frontend request bodies are capped at 64 KiB, including streamed uploads. */
export const frontendBodyLimit = 64 * 1024;

/** Frontend adapters supply fixed API and static asset destinations. */
export interface FrontendServices {
  fetchApi: (request: Request) => Promise<Response>;
  fetchAsset: (request: Request) => Promise<Response>;
}

/** Apply frontend security headers to successes and errors in both runtimes. */
export function secureFrontendResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

/** Read a frontend upload without buffering beyond the request body limit. */
export async function readFrontendBody(request: Request): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get("content-length")) > frontendBodyLimit) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const bytes: unknown = chunk.value;
        if (!(bytes instanceof Uint8Array)) throw new Error("Frontend request stream must contain bytes");
        size += bytes.byteLength;
        if (size > frontendBodyLimit) {
          await reader.cancel();
          return null;
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body.buffer;
}

async function routeFrontendRequest(request: Request, services: FrontendServices): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const apiRoute = path === "/healthz" || /^\/api\/(?:notes|jobs)(?:\/[A-Za-z0-9_-]+)?$/u.test(path);
  if (apiRoute) {
    const createRoute = path === "/api/notes" || path === "/api/jobs";
    const allowedMethod = createRoute ? "POST" : "GET";
    if (request.method !== allowedMethod) return new Response("Method not allowed", { status: 405, headers: { Allow: allowedMethod } });
    if (url.search) return new Response("Query parameters are not supported", { status: 400 });
    const headers = new Headers({ Accept: "application/json" });
    if (path !== "/healthz") {
      const authorization = request.headers.get("authorization");
      if (authorization === null || !/^Bearer \S+$/iu.test(authorization)) return new Response("Bearer token required", { status: 401 });
      headers.set("Authorization", authorization);
    }
    let body: ArrayBuffer | undefined = undefined;
    if (createRoute) {
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return new Response("JSON body required", { status: 415 });
      const boundedBody = await readFrontendBody(request);
      if (boundedBody === null) return new Response("Request body too large", { status: 413 });
      body = boundedBody;
      headers.set("Content-Type", "application/json");
    }
    const upstream = await services.fetchApi(new Request(`http://frontend-api${path}`, {
      method: request.method, headers, ...(body === undefined ? {} : { body }),
      redirect: "manual", signal: AbortSignal.timeout(15_000)
    }));
    // Never allow a redirect to send the browser or its token to another origin.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return new Response("API redirect refused", { status: 502 });
    }
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }
  if (!["/", "/index.html", "/app.js", "/style.css"].includes(path)) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  return services.fetchAsset(request);
}

/** Resolve frontend requests through an Effect v4 boundary with sanitized failures. */
export function handleFrontendRequest(request: Request, services: FrontendServices): Promise<Response> {
  return Effect.runPromise(Effect.tryPromise(() => routeFrontendRequest(request, services)).pipe(
    catchFrontendFailure(() => Effect.succeed(new Response("Frontend upstream unavailable", { status: 502 }))),
    Effect.map(secureFrontendResponse)
  ));
}
