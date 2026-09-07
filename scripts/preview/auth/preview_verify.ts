import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { previewIo, previewRecord, previewString } from "../preview_model.ts";
import { createPreviewVerifiedSession } from "./preview_auth_session.ts";
import type { PreviewPublicUrls } from "./preview_auth_session.ts";
import type { PreviewVerificationInbox } from "./preview_email_inbox.ts";

const ingressPollLimit = 20;
const verificationTimeoutMs = 20_000;
const verificationPollDelayMs = 3000;
const jobPollLimit = 40;
const httpUnauthorized = 401;
const httpOk = 200;
const httpCreated = 201;
const httpAccepted = 202;

async function verifyPreviewIngress(urls: PreviewPublicUrls): Promise<void> {
  let ready = false;

  for (let attempt = 0; attempt < ingressPollLimit; attempt += 1) {
    try {
      const health = await fetch(`${urls.api}/readyz`, {
        redirect: "error",
        signal: AbortSignal.timeout(verificationTimeoutMs),
      });

      const frontend = await fetch(urls.frontend, {
        redirect: "error",
        signal: AbortSignal.timeout(verificationTimeoutMs),
      });

      await frontend.body?.cancel();
      ready = health.ok && frontend.ok;
    } catch {
      /* Bound propagation retries; never log a response. */
    }

    if (ready) {
      break;
    }

    await delay(verificationPollDelayMs);
  }

  if (!ready) {
    throw new Error("Preview readiness failed");
  }

  const preflight = await fetch(`${urls.api}/api/v1/notes`, {
    method: "OPTIONS",
    redirect: "error",
    signal: AbortSignal.timeout(verificationTimeoutMs),
    headers: {
      Origin: urls.frontend,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  if (
    !preflight.ok ||
    preflight.headers.get("access-control-allow-origin") !== urls.frontend ||
    preflight.headers.get("access-control-allow-credentials") !== "true"
  ) {
    throw new Error("Preview exact frontend credentialed CORS failed");
  }

  const foreign = await fetch(`${urls.api}/api/v1/notes`, {
    method: "OPTIONS",
    redirect: "error",
    signal: AbortSignal.timeout(verificationTimeoutMs),
    headers: { Origin: "https://untrusted.invalid", "Access-Control-Request-Method": "POST" },
  });

  if (foreign.headers.get("access-control-allow-origin") !== null) {
    throw new Error("Preview foreign CORS origin allowed");
  }

  const specification = await fetch(`${urls.api}/openapi.json`, {
    redirect: "error",
    signal: AbortSignal.timeout(verificationTimeoutMs),
  });

  if (!specification.ok) {
    throw new Error("Preview public OpenAPI unavailable");
  }

  const denied = await fetch(`${urls.api}/api/v1/notes`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(verificationTimeoutMs),
    headers: { "Content-Type": "application/json", Origin: urls.frontend },
    body: JSON.stringify({ content: "preview verification" }),
  });

  if (denied.status !== httpUnauthorized) {
    throw new Error("Preview anonymous mutation accepted");
  }
}

async function verifyPreviewBrowser(
  context: BrowserContext,
  urls: PreviewPublicUrls,
  noteId: string,
): Promise<void> {
  const page = await context.newPage();
  const response = await page.goto(`${urls.frontend}/workspace`);
  const title = await page.title();

  if (
    response?.ok() !== true ||
    title.length === 0 ||
    response.headers()["content-security-policy"] === undefined
  ) {
    throw new Error("Preview browser frontend failed");
  }

  const runtimeResponse = await context.request.get(`${urls.frontend}/runtime-config.json`);
  const runtimeValue: unknown = await runtimeResponse.json();
  const runtime = previewRecord(runtimeValue);

  if (
    !runtimeResponse.ok() ||
    runtime["API_URL"] !== urls.api ||
    runtime["ENVIRONMENT"] !== "preview"
  ) {
    throw new Error("Preview public runtime configuration failed");
  }

  await page.getByRole("heading", { name: "Your workspace" }).waitFor({ timeout: 30_000 });

  await page.getByText("API healthy · preview", { exact: true }).waitFor({ timeout: 30_000 });

  // No traces, screenshots, console forwarding, or credential-bearing page arguments.
  const browserRead = await page.evaluate(
    async ({ id, apiUrl }) => {
      const readResponse = await fetch(`${apiUrl}/api/v1/notes/${id}`, { credentials: "include" });
      const value: unknown = await readResponse.json();
      return { status: readResponse.status, value };
    },
    { id: noteId, apiUrl: urls.api },
  );

  if (
    browserRead.status !== httpOk ||
    previewRecord(browserRead.value)["content"] !== "preview verification"
  ) {
    throw new Error("Preview browser session read failed");
  }
}

async function verifyPreviewData(
  context: BrowserContext,
  urls: PreviewPublicUrls,
): Promise<string> {
  const request = (path: string, method = "GET", data?: unknown) => {
    const options: Parameters<typeof context.request.fetch>[1] = {
      method,
      headers: { Origin: urls.frontend },
      maxRedirects: 0,
      timeout: verificationTimeoutMs,
    };

    if (data !== undefined) {
      options.data = data;
    }

    return context.request.fetch(`${urls.api}${path}`, options);
  };

  const created = await request("/api/v1/notes", "POST", { content: "preview verification" });

  if (created.status() !== httpCreated) {
    throw new Error("Preview note creation failed");
  }

  const noteValue: unknown = await created.json();
  const noteId = previewString(previewRecord(noteValue)["id"]);

  if (!/^[a-f0-9-]{36}$/u.test(noteId)) {
    throw new Error("Preview note ID invalid");
  }

  const read = await request(`/api/v1/notes/${noteId}`);
  const persistedValue: unknown = await read.json();

  if (!read.ok() || previewRecord(persistedValue)["content"] !== "preview verification") {
    throw new Error("Preview PostgreSQL persistence failed");
  }

  const enqueued = await request("/api/v1/jobs", "POST", { noteId });

  if (enqueued.status() !== httpAccepted) {
    throw new Error("Preview queue submission failed");
  }

  const enqueuedValue: unknown = await enqueued.json();
  const jobId = previewString(previewRecord(enqueuedValue)["id"]);

  if (!/^[a-f0-9-]{36}$/u.test(jobId)) {
    throw new Error("Preview job ID invalid");
  }

  for (let attempt = 0; attempt < jobPollLimit; attempt += 1) {
    const response = await request(`/api/v1/jobs/${jobId}`);

    if (response.status() === httpOk) {
      const resultValue: unknown = await response.json();
      const result = previewRecord(resultValue);

      if (
        result["status"] !== "completed" ||
        result["content"] !== "PREVIEW VERIFICATION" ||
        result["id"] !== jobId ||
        result["noteId"] !== noteId
      ) {
        throw new Error("Preview job result invalid");
      }

      return noteId;
    }

    if (response.status() !== httpAccepted) {
      throw new Error("Preview job failed");
    }

    await delay(verificationPollDelayMs);
  }

  throw new Error("Preview durable completion deadline exceeded");
}

/** Verify the ordinary email-verified session path, PostgreSQL and durable job behavior on the real deployment. */
export const verifyPreviewDeployment = (urls: PreviewPublicUrls, inbox: PreviewVerificationInbox) =>
  previewIo("Preview deployed behavior verification failed", async () => {
    await verifyPreviewIngress(urls);

    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      await createPreviewVerifiedSession(context, urls, inbox);

      const noteId = await verifyPreviewData(context, urls);
      await verifyPreviewBrowser(context, urls, noteId);

      const signout = await context.request.post(`${urls.api}/api/auth/sign-out`, {
        headers: { Origin: urls.frontend },
        data: {},
        maxRedirects: 0,
      });

      if (!signout.ok()) {
        throw new Error("Preview signout failed");
      }

      const denied = await context.request.get(`${urls.api}/api/v1/notes/${noteId}`, {
        headers: { Origin: urls.frontend },
        maxRedirects: 0,
      });

      if (denied.status() !== httpUnauthorized) {
        throw new Error("Preview signed-out read accepted");
      }
    } finally {
      await browser.close();
    }
  });
