import { Effect } from "effect";
import { handleFrontendRequest } from "./frontend_http.js";

/** Frontend Worker requires static assets only, with no API service or backend secrets. */
export interface CloudflareFrontendBindings {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Set assets.run_worker_first for security headers on all static responses. */
export default {
  fetch(request: Request, env: CloudflareFrontendBindings): Promise<Response> {
    return Effect.runPromise(
      handleFrontendRequest(request, {
        fetchAsset: (assetRequest) => env.ASSETS.fetch(assetRequest),
      }),
    );
  },
};
