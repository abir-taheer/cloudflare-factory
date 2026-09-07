import { randomUUID } from "node:crypto";
import { type APIRequestContext, type APIResponse, expect, test } from "@playwright/test";
import { ApiNoteSchema } from "@factory/api-contract/schema";
import { PublicFrontendSchema } from "../apps/frontend/src/lib/runtime-schema.js";
import { blackboxConfiguration } from "./blackbox-configuration.js";
import { createVerifiedAccount, readEmailLink, signIn } from "./blackbox-auth.js";

import { expectCorsHeaders, postChunkedAuth } from "./blackbox-http.js";

const apiOrigin = blackboxConfiguration.API_URL;
const mutationHeaders = { Origin: blackboxConfiguration.BASE_URL };

async function expectStatus(response: Promise<APIResponse>, status: number) {
  const result = await response;
  expect(result.status()).toBe(status);
}

async function expectSessionDenied(request: APIRequestContext) {
  const id = randomUUID();

  await Promise.all([
    expectStatus(request.get(`${apiOrigin}/api/v1/notes/${id}`), 401),
    expectStatus(request.get(`${apiOrigin}/api/v1/jobs/${id}`), 401),
    expectStatus(
      request.post(`${apiOrigin}/api/v1/notes`, {
        headers: mutationHeaders,
        data: { content: "Unauthorized" },
      }),
      401,
    ),
    expectStatus(
      request.post(`${apiOrigin}/api/v1/jobs`, {
        headers: mutationHeaders,
        data: { noteId: id },
      }),
      401,
    ),
  ]);
}

test("production static frontend supplies public config, nonce-protected MUI and working themes", async ({
  page,
  request,
}) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const headers = response?.headers();

  expect(headers?.["x-content-type-options"]).toBe("nosniff");
  expect(headers?.["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  const nonce = await page.locator('meta[name="csp-nonce"]').getAttribute("content");

  expect(nonce).toMatch(/^[A-Za-z\d+/]{22}==$/u);
  expect(headers?.["content-security-policy"]).toContain(`style-src-elem 'self' 'nonce-${nonce}'`);
  expect(headers?.["content-security-policy"]).toContain("script-src 'self';");
  expect(headers?.["content-security-policy"]).toContain(`connect-src 'self' ${apiOrigin};`);

  const styles = page.locator("style[data-emotion]");
  const styleCount = await styles.count();
  expect(styleCount).toBeGreaterThan(0);

  const styleNonces = await styles.evaluateAll((elements) =>
    elements.map((element) => (element instanceof HTMLStyleElement ? element.nonce : "")),
  );

  expect(styleNonces.every((value) => value === nonce)).toBe(true);
  await page.getByRole("combobox", { name: "Appearance" }).click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 24, 21)");

  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS(
    "background-color",
    "rgb(118, 213, 182)",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/u);

  const reloadedNonce = await page.locator('meta[name="csp-nonce"]').getAttribute("content");
  expect(reloadedNonce).not.toBe(nonce);

  const configuration = await request.get("/runtime-config.json");
  const value: unknown = await configuration.json();

  expect(PublicFrontendSchema.parse(value)).toEqual({ API_URL: apiOrigin, ENVIRONMENT: "dev" });
  await expectStatus(request.get("/api/v1/notes"), 404);
  await expectStatus(request.get("/healthz"), 404);
});

test("session-protected routes reject unauthenticated requests", async ({ request, page }) => {
  await expectSessionDenied(request);

  const forbidden = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    headers: { Origin: "https://blocked.example.test" },
    data: {},
  });

  expect(forbidden.status()).toBe(403);
  expect(forbidden.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(forbidden.headers()["x-request-id"]).toBeTruthy();

  const invalidAuth = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    headers: mutationHeaders,
    data: {},
  });

  expect(invalidAuth.status()).toBe(400);
  expectCorsHeaders(invalidAuth);
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("verified account creates and reads a real note, completes a workflow, then signs out", async ({
  page,
}) => {
  await createVerifiedAccount(page);

  const content = `A useful mixed Case note ${randomUUID()} <b>plain text</b>`;
  await page.getByLabel(/^Note content/u).fill(content);

  const created = page.waitForResponse(
    (response) =>
      response.url() === `${apiOrigin}/api/v1/notes` && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Create note", exact: true }).click();

  const response = await created;

  expect(response.status()).toBe(201);
  expectCorsHeaders(response);

  const value: unknown = await response.json();
  const note = ApiNoteSchema.parse(value);

  expect(note.content).toBe(content);
  await expect(page.getByTestId("note-content")).toHaveText(content);
  await expect(page.getByTestId("note-content").locator("b")).toHaveCount(0);
  await page.getByLabel(/^Note ID/u).fill(note.id);

  const read = page.waitForResponse(`${apiOrigin}/api/v1/notes/${note.id}`);

  await page.getByRole("button", { name: "Read note", exact: true }).click();

  const readResponse = await read;

  expect(readResponse.status()).toBe(200);
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();

  await expect(page.getByTestId("job-content")).toHaveText(content.toUpperCase(), {
    timeout: 90_000,
  });

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expectSessionDenied(page.request);
});

test("authenticated invalid note and job payloads fail at the real API boundary", async ({
  page,
}) => {
  await createVerifiedAccount(page);

  const request = page.request;

  const invalid = page.waitForResponse(
    (response) =>
      response.url() === `${apiOrigin}/api/v1/notes` && response.request().method() === "POST",
  );

  const invalidStatus = await page.evaluate(async (origin) => {
    const response = await fetch(`${origin}/api/v1/notes`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });

    return response.status;
  }, apiOrigin);

  expect(invalidStatus).toBe(400);

  const invalidResponse = await invalid;
  expectCorsHeaders(invalidResponse);

  await Promise.all(
    [{}, { content: "" }, { content: "   " }, { content: 42 }, { content: "x".repeat(4001) }].map(
      (data) =>
        expectStatus(
          request.post(`${apiOrigin}/api/v1/notes`, { headers: mutationHeaders, data }),
          400,
        ),
    ),
  );

  await Promise.all(
    [{}, { noteId: "" }, { noteId: 42 }, { noteId: "invalid" }].map((data) =>
      expectStatus(
        request.post(`${apiOrigin}/api/v1/jobs`, { headers: mutationHeaders, data }),
        400,
      ),
    ),
  );

  await expectStatus(
    request.post(`${apiOrigin}/api/v1/notes`, {
      headers: { ...mutationHeaders, "Content-Type": "application/json" },
      data: "{",
    }),
    400,
  );

  await expectStatus(
    request.post(`${apiOrigin}/api/v1/notes`, {
      headers: { ...mutationHeaders, "Content-Type": "text/plain" },
      data: "hello",
    }),
    415,
  );

  await expectStatus(request.get(`${apiOrigin}/api/v1/notes/${randomUUID()}`), 404);
});

test("delivered password reset changes the password and revokes the existing session", async ({
  page,
}) => {
  const account = await createVerifiedAccount(page);

  await page.goto("/forgot-password");
  await page.getByLabel(/^Email address/u).fill(account.email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();

  await expect(
    page.getByText("If this address is eligible, an email is on its way. Check your inbox."),
  ).toBeVisible();

  const resetLink = await readEmailLink(page.request, account.email, "Reset your password");
  await page.goto(resetLink);

  const newPassword = `Updated-test-${randomUUID()}`;

  await page.getByLabel(/^Password/u).fill(newPassword);
  await page.getByRole("button", { name: "Save new password", exact: true }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
  await expectSessionDenied(page.request);
  await signIn(page, { ...account, password: newPassword });
});

test("auth rejects oversized announced and chunked request bodies before creating an account", async ({
  request,
}) => {
  const body = JSON.stringify({ filler: "x".repeat(16_385) });

  await expectStatus(
    request.post(`${apiOrigin}/api/auth/sign-up/email`, {
      headers: { ...mutationHeaders, "Content-Type": "application/json" },
      data: body,
    }),
    413,
  );

  const chunkedStatus = await postChunkedAuth(body);
  expect(chunkedStatus).toBe(413);
});
