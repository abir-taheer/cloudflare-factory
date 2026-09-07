import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { previewIo, previewRecord, previewString } from "./preview-model.ts";

function verifyPreviewJobResult(value: unknown, jobId: string, noteId: string): void {
  const result = previewRecord(value);
  if (result["status"] !== "completed" || result["content"] !== "PREVIEW VERIFICATION" ||
    result["id"] !== jobId || result["noteId"] !== noteId) throw new Error("Incorrect job result");
}

/** Blackbox probes verify D1 persistence and Queue → Workflow → DO → R2 completion through the frontend. */
export const verifyPreviewDeployment = (url: string, token: string) => previewIo("Preview deployed behavior verification failed", async () => {
  const request = async (path: string, method = "GET", body?: unknown, authorized = true) => {
    const response = await fetch(`${url}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response;
  };
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { const health = await request("/healthz"); ready = health.ok; } catch { /* Bound propagation retries; never log a response. */ }
    if (ready) break;
    await delay(3000);
  }
  if (!ready) throw new Error("Health failed");
  const denied = await request("/api/notes", "POST", { content: "preview verification" }, false);
  if (denied.status !== 401) throw new Error("Anonymous mutation accepted");
  const created = await request("/api/notes", "POST", { content: "preview verification" });
  if (created.status !== 201) throw new Error("Note creation failed");
  const note = previewRecord(await created.json());
  const noteId = previewString(note["id"]);
  if (!/^[a-f0-9-]{36}$/u.test(noteId)) throw new Error("Invalid note ID");
  const read = await request(`/api/notes/${noteId}`);
  const persisted = previewRecord(await read.json());
  if (!read.ok || (persisted["content"] ?? persisted["text"]) !== "preview verification") throw new Error("D1 persistence failed");
  const enqueued = await request("/api/jobs", "POST", { noteId });
  if (enqueued.status !== 202) throw new Error("Queue submission failed");
  const jobId = previewString(previewRecord(await enqueued.json())["id"]);
  if (!/^[a-f0-9-]{36}$/u.test(jobId)) throw new Error("Invalid job ID");
  let complete = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await request(`/api/jobs/${jobId}`);
    if (response.status === 200) {
      verifyPreviewJobResult(await response.json(), jobId, noteId);
      complete = true;
      break;
    }
    if (response.status !== 202) throw new Error("Job failed");
    await delay(3000);
  }
  if (!complete) throw new Error("Durable completion deadline exceeded");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(url);
    if (response?.ok() !== true || !(await page.title()) || response.headers()["content-security-policy"] === undefined) throw new Error("Browser frontend failed");
    // No traces, screenshots, video, console forwarding or token-bearing artifacts.
    const status = await page.evaluate(async ({ id, credential }) => {
      const readResponse = await fetch(`/api/notes/${id}`, { headers: { Authorization: `Bearer ${credential}` } });
      return readResponse.status;
    }, { id: noteId, credential: token });
    if (status !== 200) throw new Error("Browser authenticated read failed");
  } finally { await browser.close(); }
});
