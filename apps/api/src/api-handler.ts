import { Effect } from "effect";
import { createApiApplication } from "./http/api-application.js";
import type { ApiConfiguration, ApiServices } from "./http/api-context.js";

const application = createApiApplication();

/** Both entry points lend scoped services; cancellation reaches all route effects. */
export const handleApiRequest = (request: Request, configuration: ApiConfiguration) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<ApiServices>();

    return yield* Effect.tryPromise((signal) =>
      Promise.resolve(
        application.fetch(request, {
          configuration,
          services,
          signal: AbortSignal.any([signal, request.signal]),
        }),
      ),
    );
  });
