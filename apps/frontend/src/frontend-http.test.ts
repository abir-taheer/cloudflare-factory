import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { Effect } from "effect";
import { catch as catchFixtureFailure } from "effect/Effect";
import { createFrontendServer } from "./node-frontend.js";
import cloudflareFrontend from "./cloudflare-frontend.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await server[Symbol.asyncDispose]();
}

async function fetchFrontendJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const data: unknown = await response.json();
  return data;
}

async function expectFrontendStatus(url: string, status: number, init?: RequestInit) {
  const response = await fetch(url, init);
  assert.equal(response.status, status);
}

await test("portable frontend serves assets and completes authenticated note and job HTTP flows", async (context) => {
  let noteContent = "";
  let hits = 0;
  const api = createServer((request, response) => {
    const handleFixture = Effect.tryPromise(async () => {
    hits += 1;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/healthz") { response.end(JSON.stringify({ status: "ok", environment: "test" })); return; }
    if (request.headers.authorization !== "Bearer test-secret") { response.writeHead(401).end(); return; }
    assert.equal(request.headers.cookie, undefined);
    let body = "";
    for await (const chunk of request) body += String(chunk);
    if (request.url === "/api/notes" && request.method === "POST") {
      const input: unknown = JSON.parse(body);
      assert.ok(typeof input === "object" && input !== null && "content" in input && typeof input.content === "string");
      noteContent = input.content;
      response.writeHead(201).end(JSON.stringify({ id: "note-1", content: noteContent }));
    } else if (request.url === "/api/notes/note-1") {
      response.end(JSON.stringify({ id: "note-1", content: noteContent }));
    } else if (request.url === "/api/jobs") {
      assert.deepEqual(JSON.parse(body), { noteId: "note-1" });
      response.writeHead(202).end(JSON.stringify({ id: "job-1", status: "queued" }));
    } else if (request.url === "/api/jobs/job-1") {
      response.end(JSON.stringify({ id: "job-1", status: "completed" }));
    } else if (request.url === "/api/notes/redirect") {
      response.writeHead(302, { Location: "https://example.com" }).end();
    } else { response.writeHead(404).end(JSON.stringify({ error: "not found" })); }
    });
    Effect.runFork(handleFixture.pipe(catchFixtureFailure(() => Effect.sync(() => { response.destroy(); }))));
  });
  const apiUrl = await listen(api);
  const frontend = createFrontendServer(apiUrl);
  const base = await listen(frontend);
  context.after(async () => { await close(frontend); await close(api); });
  await Promise.all(["/", "/app.js", "/style.css", "/healthz"].map(async (path) => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.text();
  }));
  const headers = { Authorization: "Bearer test-secret", "Content-Type": "application/json", Cookie: "not-forwarded=1" };
  const created = await fetch(`${base  }/api/notes`, { method: "POST", headers, body: JSON.stringify({ content: "hello <script>world</script>" }) });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { id: "note-1", content: "hello <script>world</script>" });
  assert.deepEqual(await fetchFrontendJson(`${base}/api/notes/note-1`, { headers }), { id: "note-1", content: noteContent });
  const job = await fetch(`${base  }/api/jobs`, { method: "POST", headers, body: JSON.stringify({ noteId: "note-1" }) });
  assert.equal(job.status, 202);
  assert.deepEqual(await job.json(), { id: "job-1", status: "queued" });
  assert.deepEqual(await fetchFrontendJson(`${base}/api/jobs/job-1`, { headers }), { id: "job-1", status: "completed" });
  await expectFrontendStatus(`${base}/api/notes/missing`, 404, { headers });
  await expectFrontendStatus(`${base}/api/notes/redirect`, 502, { headers });
  const hitsBeforeInvalid = hits;
  await expectFrontendStatus(`${base}/api/notes/note-1`, 401);
  await expectFrontendStatus(`${base}/api/notes`, 405, { headers });
  await expectFrontendStatus(`${base}/api/elsewhere`, 404, { headers });
  await expectFrontendStatus(`${base}/api/notes/note-1?url=https://example.com`, 400, { headers });
  await expectFrontendStatus(`${base}/package.json`, 404);
  const oversized = await fetch(`${base  }/api/notes`, { method: "POST", headers, body: "x".repeat(65_537) });
  assert.equal(oversized.status, 413);
  const chunked = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32_768)); controller.enqueue(new Uint8Array(32_769)); controller.close(); } });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body: chunked, duplex: "half" };
  await expectFrontendStatus(`${base}/api/notes`, 413, init);
  assert.equal(hits, hitsBeforeInvalid);
});

await test("portable frontend fails closed on invalid configuration and unreachable API", async (context) => {
  for (const url of ["", "file:///tmp", "https://user:secret@example.com", "https://example.com/api", "https://example.com?target=x"]) assert.throws(() => createFrontendServer(url));
  const frontend = createFrontendServer("http://127.0.0.1:1");
  const base = await listen(frontend);
  context.after(() => close(frontend));
  const response = await fetch(`${base  }/healthz`);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Frontend upstream unavailable");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

await test("Cloudflare entrypoint uses binding responses and secures missing-binding failures without Workers", async () => {
  const response = await cloudflareFrontend.fetch(new Request("https://frontend.example/healthz"), {
    ENVIRONMENT: "preview",
    API: { fetch: async () => Response.json({ environment: "preview" }) },
    ASSETS: { fetch: async () => new Response("asset") }
  });
  assert.deepEqual(await response.json(), { environment: "preview" });
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const failure = await cloudflareFrontend.fetch(new Request("https://frontend.example/healthz"), {
    ENVIRONMENT: "preview",
    API: { fetch: async () => { throw new Error("private connection details"); } },
    ASSETS: { fetch: async () => new Response("asset") }
  });
  assert.equal(failure.status, 502);
  assert.equal(await failure.text(), "Frontend upstream unavailable");
});
