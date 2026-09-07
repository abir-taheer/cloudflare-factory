import { ConfigProvider, Effect } from "effect";
import { createServer } from "vite";
import { frontendViteConfiguration } from "./node-vite-config.js";
import { parseFrontendDevConfiguration } from "./frontend-configuration.js";

const notFoundStatus = 404;

const configuration = Effect.runSync(parseFrontendDevConfiguration(ConfigProvider.fromEnv()));

const server = await createServer({
  ...frontendViteConfiguration(),
  server: {
    host: "0.0.0.0",
    port: configuration.PORT,
    strictPort: true,
    allowedHosts: ["frontend"],
  },
});

server.middlewares.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  // Vite dev alone needs inline refresh/styles and HMR WebSockets.
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: ${configuration.VITE_API_URL}; frame-ancestors 'none'; base-uri 'none'`,
  );

  if (request.url === "/runtime-config.json") {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");

    response.end(
      JSON.stringify({
        API_URL: configuration.VITE_API_URL,
        ENVIRONMENT: configuration.ENVIRONMENT,
      }),
    );
  } else if (request.url?.startsWith("/api") === true || request.url === "/healthz") {
    response.writeHead(notFoundStatus);
    response.end("Not found");
  } else {
    // eslint-disable-next-line node/callback-return -- Last statement in the mutually exclusive Vite middleware branch; no work follows.
    next();
  }
});

await server.listen();
