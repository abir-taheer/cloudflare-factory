/* eslint-disable import/no-nodejs-modules -- This standalone browser regression runner hosts a Node HTTP fixture inside Docker. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
/* eslint-enable import/no-nodejs-modules */
import { chromium, expect } from "@playwright/test";
import { Effect } from "effect";
import { catch as catchFixtureFailure } from "effect/Effect";
import { createFrontendServer } from "../src/node-frontend.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

const api = createServer((request, response) => {
  const handleFixture = Effect.tryPromise(async () => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/healthz") { response.end(JSON.stringify({ environment: "browser-test", status: "ok" })); return; }
  if (request.headers.authorization !== "Bearer browser-test-token") { response.writeHead(401).end(); return; }
  let body = "";
  for await (const chunk of request) body += String(chunk);
  if (request.url === "/api/notes") {
    assert.deepEqual(JSON.parse(body), { content: "<img src=x onerror=alert(1)>" });
    response.writeHead(201).end(JSON.stringify({ id: "note-1", content: "<img src=x onerror=alert(1)>" }));
  } else if (request.url === "/api/notes/note-1") {
    response.end(JSON.stringify({ id: "note-1", content: "<img src=x onerror=alert(1)>" }));
  } else if (request.url === "/api/jobs") {
    assert.deepEqual(JSON.parse(body), { noteId: "note-1" });
    response.writeHead(202).end(JSON.stringify({ id: "job-1", status: "queued" }));
  } else { response.end(JSON.stringify({ id: "job-1", status: "completed" })); }
  });
  Effect.runFork(handleFixture.pipe(catchFixtureFailure(() => Effect.sync(() => { response.destroy(); }))));
});
const apiUrl = await listen(api);
const frontend = createFrontendServer(apiUrl);
const base = await listen(frontend);
try {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push(error.message); });
    await page.goto(base);
    await page.getByText("API healthy", { exact: true }).waitFor();
    await page.getByText("Environment: browser-test", { exact: true }).waitFor();
    await page.locator("#content").fill("<img src=x onerror=alert(1)>");
    await page.getByRole("button", { name: "Create note" }).click();
    await page.getByText("Enter a bearer token to call the API.", { exact: true }).waitFor();
    await page.locator("#token").fill("browser-test-token");
    await page.getByRole("button", { name: "Create note" }).click();
    await expect(page.locator("#note-id")).toHaveValue("note-1");
    assert.equal(await page.locator("#job-note-id").inputValue(), "note-1");
    assert.equal(await page.locator("#note-result img").count(), 0);
    await page.getByRole("button", { name: "Read note", exact: true }).click();
    await expect(page.locator("#note-result")).toHaveAttribute("data-state", "ok");
    await page.getByRole("button", { name: "Start workflow" }).click();
    await page.getByText("· queued", { exact: true }).waitFor();
    assert.equal(await page.locator("#job-id").inputValue(), "job-1");
    await page.getByRole("button", { name: "Check status" }).click();
    await page.getByText("· completed", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.reload();
    assert.equal(await page.locator("#token").inputValue(), "");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
} finally {
  frontend.closeAllConnections(); frontend.close();
  api.closeAllConnections(); api.close();
}
