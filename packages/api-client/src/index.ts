import createFetchClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";
import type { paths } from "./api-paths.js";
import { apiResponseValidation } from "./http.js";

/** Generated paths drive transport and Query types; Better Auth session cookies use the public API origin. */
export function createFactoryApiClient(apiOrigin: string) {
  const http = createFetchClient<paths>({
    baseUrl: apiOrigin,
    credentials: "include",
    redirect: "error",
  });

  http.use(apiResponseValidation);
  return { http, query: createQueryClient(http) };
}
