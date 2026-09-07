/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://frontend:5173";
const frontendOrigin = new URL(baseURL);
const hasHttpProtocol = ["http:", "https:"].includes(frontendOrigin.protocol);

if (
  !hasHttpProtocol ||
  frontendOrigin.username ||
  frontendOrigin.password ||
  frontendOrigin.pathname !== "/" ||
  frontendOrigin.search ||
  frontendOrigin.hash
) {
  throw new Error(
    "Blackbox BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment",
  );
}

/** Blackbox tests use the running frontend and real providers; no test web server or mocks. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "blackbox.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  outputDir: "/tmp/factory-blackbox-results",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Authentication cookies, verification links and private content must stay out of artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
