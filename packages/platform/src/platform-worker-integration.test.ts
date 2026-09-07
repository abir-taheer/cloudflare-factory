import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Pool } from "pg";
import { buildPreviewArtifacts } from "../../../scripts/preview-build.ts";

test("emitted Worker artifacts boot in workerd", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "platform-workers-"));
  try {
    await Effect.runPromise(buildPreviewArtifacts(".", directory));
    await Promise.all(["api", "workflows", "frontend"].map(async name => {
      const runtime = new Miniflare(convertV4MiniflareOptions({
        name, modules: true, modulesRoot: directory, scriptPath: path.join(directory, `${name}.mjs`),
        compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
        bindings: { ENVIRONMENT: "dev", API_TOKEN: "local-development-only" },
      }));
      try {
        const response = await runtime.dispatchFetch("http://worker/healthz");
        assert.equal(response.status, name === "workflows" ? 404 : 200);
      } finally { await runtime.dispose(); }
    }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("emitted API Worker persists notes through Hyperdrive proxy to real Postgres", {
  skip: process.env["PLATFORM_INTEGRATION"] !== "1", timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "platform-hyperdrive-worker-"));
  const databaseUrl = process.env["DATABASE_URL"] ?? "";
  const pool = new Pool({ connectionString: databaseUrl });
  const content = `workerd-${randomUUID()}`;
  let runtime: Miniflare | undefined;
  try {
    await Effect.runPromise(buildPreviewArtifacts(".", directory));
    runtime = new Miniflare(convertV4MiniflareOptions({
      name: "api", modules: true, modulesRoot: directory, scriptPath: path.join(directory, "api.mjs"),
      compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
      bindings: { ENVIRONMENT: "dev", API_TOKEN: "local-development-only" },
      hyperdrives: { HYPERDRIVE: databaseUrl },
    }));
    const headers = { Authorization: "Bearer local-development-only", "Content-Type": "application/json" };
    const created = await runtime.dispatchFetch("http://worker/api/notes", {
      method: "POST", headers, body: JSON.stringify({ content }),
    });
    assert.equal(created.status, 201, await created.clone().text());
    const note = await created.json() as { id: string };
    const read = await runtime.dispatchFetch(`http://worker/api/notes/${note.id}`, { headers });
    assert.equal(read.status, 200, await read.clone().text());
    const saved = await read.json() as { content: string };
    assert.equal(saved.content, content);
    const rows = await pool.query("SELECT text FROM notes WHERE id=$1", [note.id]);
    assert.equal(rows.rows[0]?.text, content);
  } finally {
    await runtime?.dispose();
    await pool.query("DELETE FROM notes WHERE text=$1", [content]);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
