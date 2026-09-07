# Frontend

Static developer console; no build step. Token stays in page memory, is sent only
as `Authorization: Bearer …`, and is cleared on reload/page exit. Job status is
refreshed explicitly with **Check status**.

## Entrypoints

- `@factory/frontend/cloudflare` → `src/cloudflare-frontend.ts` (default Worker export).
  Bind `API` to the environment's API Worker and `ASSETS` to `apps/frontend/public`.
  Set the `ENVIRONMENT` scalar to `dev`, `preview`, or `prod`.
  Set `assets.run_worker_first = true` so every response receives security headers.
- `@factory/frontend/node` → `src/node-frontend.ts` (`createFrontendServer(apiUrl)` export).
  Direct execution requires `ENVIRONMENT` (`dev`, `preview`, or `prod`), `PORT`
  (integer 1–65535; use `5173` in Compose), and `API_URL` as an explicit HTTP(S)
  origin. It serves `public` relative to the module.

Both runtimes validate scalars with Effect v4 Schema through ConfigProvider.
Keys stay identical across dev/preview/prod; there are no environment or endpoint
fallbacks. Node rejects invalid configuration before listening. Cloudflare returns
a secured 503 before accessing bindings. Configuration errors omit supplied values.

## Proposed API responses

| Request | JSON response |
| --- | --- |
| `GET /healthz` (public) | `{ "status": "ok", "environment": "local" }` |
| `POST /api/notes` with `{ "content": "…" }` | `{ "id": "…", "content": "…" }` |
| `GET /api/notes/:id` | `{ "id": "…", "content": "…" }` |
| `POST /api/jobs` with `{ "noteId": "…" }` | `{ "id": "…", "status": "queued" }` |
| `GET /api/jobs/:id` | `{ "id": "…", "status": "completed" }` |

IDs contain letters, numbers, underscores or hyphens. The UI displays additional
JSON fields as text. A successful health HTTP status indicates availability;
missing environment is displayed as unreported. Proxy requests accept only the
routes/methods above, reject query strings and redirects, and limit JSON bodies
to 64 KiB. Upstream requests time out after 15 seconds. No production fallback.

## Verify (Docker only)

```sh
docker compose run --rm tools npm run check --workspace @factory/frontend
docker compose run --rm tools npm run test --workspace @factory/frontend
docker compose run --rm tools npm run check
```

The HTTP tests run a portable API fixture and frontend on ephemeral loopback ports.
They do not start Workers or use remote bindings.

`npm run test:browser --workspace @factory/frontend` additionally exercises the UI
using Playwright Chromium in Docker (requires Chromium and its system dependencies
in the tools container).
