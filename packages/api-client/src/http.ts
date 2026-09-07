const tooManyRequestsStatus = 429;
const badGatewayStatus = 502;
const unavailableStatus = 503;
const gatewayTimeoutStatus = 504;
const unauthorizedStatus = 401;

let configuredOrigin: string | null = null;

/** Configure only the validated public API origin; there is no production fallback. */
export function configureApiClient(origin: string): void {
  configuredOrigin = new URL(origin).origin;
}

/** Normalized API failures expose safe HTTP metadata to retry policy and feature UI. */
export class ApiClientError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;

    this.retryable =
      status === null ||
      [tooManyRequestsStatus, badGatewayStatus, unavailableStatus, gatewayTimeoutStatus].includes(
        status,
      );
  }
}

/** Orval hook error type retains the documented API response without leaking transport causes. */
export type ErrorType<T> = ApiClientError & { readonly body?: T };

/** Generated endpoints own paths/types; transport uses direct credentialed CORS and never redirects. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (configuredOrigin === null) {
    throw new ApiClientError("API configuration is unavailable", null);
  }

  const url = new URL(path, configuredOrigin);

  if (url.origin !== configuredOrigin) {
    throw new ApiClientError("API origin mismatch", null);
  }

  const response = await fetch(url, { ...options, credentials: "include", redirect: "error" });

  if (!response.ok) {
    let message = `API request failed (${response.status}).`;

    if (response.status === unauthorizedStatus) {
      message = "Please sign in to continue.";
    }

    throw new ApiClientError(message, response.status);
  }

  const data: unknown = await response.json();
  // eslint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion, factory/no-type-casts -- Orval supplies T from the same Zod/OpenAPI contract enforced by the API response boundary.
  return data as T;
}
