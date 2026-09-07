import { createServer } from "node:http";
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect";
import { HttpEffect, HttpServer } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { portablePlatformLayer } from "@factory/platform/portable";
import { handleApiRequest } from "./api_handler.js";
import { readApiConfiguration } from "./api_configuration.js";
import { parsePortableConfiguration } from "@factory/platform/configuration";
import { nodeAuthenticationLayer } from "./node_authentication.js";

const configuration = Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnv()));
const apiConfiguration = readApiConfiguration();

const server = Effect.scoped(
  Effect.gen(function* () {
    // Keep provider connections across requests; close them after the HTTP server stops.
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() =>
        ManagedRuntime.make(
          nodeAuthenticationLayer(configuration.databaseUrl, apiConfiguration).pipe(
            Layer.provideMerge(portablePlatformLayer(configuration)),
          ),
        ),
      ),
      (managedRuntime) => managedRuntime.disposeEffect,
    );

    const application = HttpEffect.fromWebHandler((request) =>
      runtime.runPromise(handleApiRequest(request, apiConfiguration), { signal: request.signal }),
    );

    yield* HttpServer.serve(application).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: 8787, host: "0.0.0.0" })),
      Layer.launch,
    );
  }),
);

NodeRuntime.runMain(server);
