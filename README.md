# Cloudflare Factory

A Node monorepo for isolated Cloudflare previews and portable, Docker-only development. Backend services use Effect v4 (`4.0.0-rc.112`, a release candidate).

## Local development

Install Docker Desktop, then:

```sh
docker compose run --rm tools npm ci
docker compose up --build --wait
docker compose run --rm tools npm run check
docker compose run --rm browser-tests
```

Open http://localhost:5174. Use `local-development-only` as the demo token. Create a note, queue a job, and inspect its uppercase output. Mail capture is at http://localhost:8025. Local credentials are disposable, public development fixtures; never use them in deployment.

All apps run in Docker using PostgreSQL, Redis, S3-compatible storage, SMTP capture and Temporal. No Wrangler dev, Miniflare, workerd or remote bindings participate in local development. `docker compose down` retains data; add `--volumes` only to reset disposable local data.

## Layout

- `apps/frontend`: static UI and same-origin API proxy, with Worker and Node entrypoints.
- `apps/api`: authenticated Effect HTTP application.
- `apps/workflows`: Cloudflare and Temporal orchestration around the same domain job.
- `apps/executor`: constrained local command executor, on an internal network without host mounts or Docker socket.
- `packages/platform`: capability contracts and Cloudflare/portable implementations.
- `scripts/preview-*`: preview provisioning, deployment, verification and cleanup.

## Deployment

See [preview environments](docs/preview-environments.md) for Doppler and named GitHub environment setup. Each PR receives empty independent data resources; production credentials/data are never a fallback. Sandbox deployment is opt-in because Cloudflare requires a paid plan. Hyperdrive requires an explicitly configured empty-database provisioner.

See [Effect v4 and lint guidance](docs/effect-v4.md) for the pinned APIs and validation policy. Replace capability Layers at the composition root; domain operations do not depend on Worker bindings.

This is a bootstrap with a bearer-token demonstration, not an end-user identity system. Add application authorization before introducing users or sensitive data. Cloudflare and local providers share contracts, not identical consistency or failure semantics.
