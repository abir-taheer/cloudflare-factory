import { createAuthClient } from "better-auth/react";
import { getFrontendConfiguration } from "./runtime-configuration.js";

/** Better Auth owns its protocol; session cookies travel only to the exact public API origin. */
export const authClient = createAuthClient({
  baseURL: getFrontendConfiguration().API_URL,
  fetchOptions: { credentials: "include" },
});
