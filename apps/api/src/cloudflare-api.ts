import { ConfigProvider, Effect } from 'effect';
import { cloudflarePlatformLayer, type CloudflarePlatformBindings } from '@factory/platform/cloudflare';
import { parseApiConfiguration } from './api-configuration.js';
import { handleApiRequest, type ApiConfiguration } from './api-handler.js';

interface ApiBindings extends CloudflarePlatformBindings { readonly API_TOKEN: string; readonly ENVIRONMENT: ApiConfiguration['environment'] }

export default {
  fetch(request: Request, bindings: ApiBindings): Promise<Response> {
    return Effect.runPromise(parseApiConfiguration(ConfigProvider.fromUnknown(bindings)).pipe(
      Effect.flatMap((configuration) => handleApiRequest(request, configuration).pipe(Effect.provide(cloudflarePlatformLayer(bindings)))),
      Effect.orElseSucceed(() => Response.json({error:'Service not configured'}, {status:503,headers:{'cache-control':'no-store'}})),
    ));
  },
};
