import { Effect } from "effect";
import { PublicFrontendSchema } from "./lib/runtime_schema.js";

/** Static adapters expose assets only; no API transport or secret bindings. */
export interface FrontendServices {
  readonly fetchAsset: (request: Request) => Promise<Response>;
}

/** Production connections are restricted to the public API origin from the validated artifact. */
export function secureFrontendResponse(
  response: Response,
  apiOrigin = "",
  immutable = false,
  nonce = "",
): Response {
  const headers = new Headers(response.headers);

  let nonceSource = "";

  if (nonce.length > 0) {
    nonceSource = ` 'nonce-${nonce}'`;
  }

  // Emotion style tags require a nonce; MUI dynamic positioning needs style attributes.
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self'${nonceSource}; style-src-attr 'unsafe-inline'; connect-src 'self' ${apiOrigin}; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  return new Response(response.body, { status: response.status, headers });
}

async function serveFrontendAssets(request: Request, services: FrontendServices) {
  const url = new URL(request.url);

  const isApiRoute =
    url.pathname.startsWith("/api") ||
    ["/healthz", "/readyz", "/openapi.json"].includes(url.pathname);

  if (isApiRoute) {
    return secureFrontendResponse(new Response("Not found", { status: 404 }));
  }

  const isReadMethod = ["GET", "HEAD"].includes(request.method);

  if (!isReadMethod) {
    return secureFrontendResponse(
      new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }),
    );
  }

  const isAsset = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2|svg)$/u.test(url.pathname);

  const isPage = [
    "/",
    "/index.html",
    "/login",
    "/signup",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/workspace",
  ].includes(url.pathname);

  if (!isAsset && !isPage && url.pathname !== "/runtime-config.json") {
    return secureFrontendResponse(new Response("Not found", { status: 404 }));
  }

  const configResponse = await services.fetchAsset(
    new Request(new URL("/runtime-config.json", url)),
  );

  if (!configResponse.ok) {
    throw new Error("Frontend public configuration missing");
  }

  const value: unknown = await configResponse.json();
  const config = PublicFrontendSchema.parse(value);

  if (url.pathname === "/runtime-config.json") {
    return secureFrontendResponse(Response.json(config), config.API_URL);
  }

  const response = await services.fetchAsset(
    new Request(new URL(isPage ? "/index.html" : url.pathname, url), { method: request.method }),
  );

  if (isPage && response.ok && request.method === "GET") {
    const nonceByteLength = 16;

    const nonce = btoa(
      String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(nonceByteLength))),
    );

    const template = await response.text();
    const html = template.replaceAll("__FRONTEND_NONCE__", nonce);

    return secureFrontendResponse(
      new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      config.API_URL,
      false,
      nonce,
    );
  }

  return secureFrontendResponse(response, config.API_URL, isAsset && response.ok);
}

/** Static delivery sanitizes configuration and I/O failures at an Effect boundary. */
export function handleFrontendRequest(
  request: Request,
  services: FrontendServices,
): Effect.Effect<Response> {
  return Effect.tryPromise(() => serveFrontendAssets(request, services)).pipe(
    Effect.orElseSucceed(() =>
      secureFrontendResponse(new Response("Frontend service not configured", { status: 503 })),
    ),
  );
}
