/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://frontend:5173';
const frontendOrigin = new URL(baseURL);
if (!['http:', 'https:'].includes(frontendOrigin.protocol) || frontendOrigin.username || frontendOrigin.password || frontendOrigin.pathname !== '/' || frontendOrigin.search || frontendOrigin.hash) {
  throw new Error('Blackbox BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment');
}
const localFrontend = frontendOrigin.protocol === 'http:' && ['frontend', 'localhost', '127.0.0.1', '[::1]'].includes(frontendOrigin.hostname);
const token = process.env.TEST_API_TOKEN;
if ((token === undefined || token === '' || token === 'local-development-only') && !localFrontend) {
  throw new Error('Blackbox TEST_API_TOKEN must be explicitly configured for non-local BASE_URL');
}
if (token !== undefined && (token.trim().length === 0 || /\s/u.test(token))) {
  throw new Error('Blackbox TEST_API_TOKEN must be a nonempty bearer token without whitespace');
}

/** Blackbox tests use the running frontend and real providers; no test web server or mocks. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'blackbox.spec.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  outputDir: '/tmp/factory-blackbox-results',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Traces and screenshots can contain bearer credentials or note content.
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  }
});
