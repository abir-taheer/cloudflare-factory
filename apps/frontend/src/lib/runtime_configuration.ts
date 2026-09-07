import { type PublicFrontendConfiguration, PublicFrontendSchema } from "./runtime_schema.js";

let configuration: PublicFrontendConfiguration | null = null;

/** Load public configuration before auth, routes or API clients. */
export async function loadFrontendConfiguration(): Promise<PublicFrontendConfiguration> {
  const response = await fetch("/runtime-config.json", {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error("Public frontend configuration is unavailable");
  }

  const value: unknown = await response.json();

  configuration = PublicFrontendSchema.parse(value);
  return configuration;
}

/** Feature modules load only after bootstrap validates the public artifact. */
export function getFrontendConfiguration(): PublicFrontendConfiguration {
  if (configuration === null) {
    throw new Error("Frontend configuration has not loaded");
  }

  return configuration;
}
