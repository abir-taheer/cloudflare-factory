import { defineConfig, devices } from "@playwright/test";
import { blackboxConfiguration } from "./tests/blackbox_configuration.js";

/** Production Docker services share localhost origins; no proxies or fake test servers. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "blackbox.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(blackboxConfiguration.CI),
  reporter: "list",
  outputDir: "/tmp/factory-blackbox-results",
  use: {
    baseURL: blackboxConfiguration.BASE_URL,
    ...devices["Desktop Chrome"],
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Cookies, verification links and private content must stay out of artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
