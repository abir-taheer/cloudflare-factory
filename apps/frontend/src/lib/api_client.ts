import { createFactoryApiClient } from "@factory/api-client";
import { getFrontendConfiguration } from "./runtime_configuration.js";

/** Public API transport is initialized only after runtime configuration is validated. */
export const workspaceApi = createFactoryApiClient(getFrontendConfiguration().API_URL);
