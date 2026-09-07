import { type APIResponse, expect } from "@playwright/test";
import http from "node:http";
import { blackboxConfiguration } from "./blackbox-configuration.js";

/** Real chunked HTTP exercises the API body boundary without an announced Content-Length. */
export function postChunkedAuth(body: string): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();

  const request = http.request(
    `${blackboxConfiguration.API_URL}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: {
        Origin: blackboxConfiguration.BASE_URL,
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      },
    },
    (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    },
  );

  request.on("error", reject);

  request.setTimeout(10_000, () => {
    request.destroy(new Error("Chunked auth request timed out"));
  });

  request.write(body.slice(0, 1));
  request.end(body.slice(1));
  return promise;
}

/** Actual auth and business responses must retain the exact credentialed origin policy. */
export function expectCorsHeaders(response: Pick<APIResponse, "headers">) {
  const headers = response.headers();

  expect(headers["access-control-allow-origin"]).toBe(blackboxConfiguration.BASE_URL);
  expect(headers["access-control-allow-credentials"]).toBe("true");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-request-id"]).toBeTruthy();
}
