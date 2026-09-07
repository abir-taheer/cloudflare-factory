import { ConfigProvider, Effect } from "effect";
import { handleFrontendRequest, secureFrontendResponse } from "./frontend-http.js";
import { parseFrontendScalars } from "./frontend-configuration.js";

/** Cloudflare frontend requires independent API service and static assets bindings. */
export interface CloudflareFrontendBindings {
  readonly ENVIRONMENT: unknown;
  API: { fetch(request: Request): Promise<Response> };
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Cloudflare frontend entrypoint; configure assets.run_worker_first for security headers. */
export default {
  fetch(request: Request, env: CloudflareFrontendBindings): Promise<Response> {
    return Effect.runPromise(parseFrontendScalars(ConfigProvider.fromUnknown(env)).pipe(
      Effect.flatMap(() => Effect.tryPromise(() => handleFrontendRequest(request, {
        fetchApi: (apiRequest) => env.API.fetch(apiRequest),
        fetchAsset: (assetRequest) => env.ASSETS.fetch(assetRequest)
      }))),
      Effect.orElseSucceed(() => secureFrontendResponse(new Response("Frontend service not configured", { status: 503 })))
    ));
  }
};
