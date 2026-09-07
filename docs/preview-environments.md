# Preview environments

Infrastructure uses **Effect 4.0.0-rc.112**. All local commands run in Docker; they never use Wrangler dev, Miniflare, or remote bindings. Deploy commands below intentionally mutate Cloudflare; building and testing scripts does not.

## Binding contract

| Entrypoint | Bindings |
| --- | --- |
| `apps/api/src/cloudflare-api.ts` | `DATABASE` D1, `OBJECTS` R2, `CACHE` KV, `JOBS` Queue producer, cross-Worker `WORKFLOW` and `COORDINATOR`, `WORKFLOWS` service, `API_TOKEN`, `ENVIRONMENT=preview` |
| `apps/workflows/src/cloudflare-workflows.ts` | Same four data bindings, Queue consumer, `WORKFLOW` class `DemoWorkflow`, `COORDINATOR` class `JobCoordinator` |
| `apps/frontend/src/cloudflare-frontend.ts` | `API` service, `ASSETS` from `apps/frontend/public`; all requests pass through Worker security headers |

Only the frontend has a `workers.dev` address. API, workflow and DO access stays on bindings; version preview URLs are disabled. Each PR gets separate empty D1, KV, R2, Queue, Worker, Workflow and DO resources. `infra/d1.sql` initializes schema; no database cloning, production data, provider secrets or shared application storage is used. Synthetic verification creates a note and job in the PR data plane. Subsequent pushes retain that PR's data until cleanup.

## One-time configuration

Use Doppler projects `cloudflare-factory-ci`, `cloudflare-factory-api`, `cloudflare-factory-frontend`, `cloudflare-factory-workflows`, and `cloudflare-factory-executor`, each with dev/preview/prod configs. App directories map to their own development config; omit the CI project from local default scopes. Preview reads app baselines and generates PR bindings without creating Doppler configs or using write tokens.

Create GitHub environment **cloudflare-preview**, restricted to the protected default branch. Configure independent environment variables:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCOUNT_NAME` | Exact permitted account ID and live account name |
| `DOPPLER_DEPLOY_PROJECT` | `cloudflare-factory-ci` |
| `DOPPLER_API_PROJECT` | `cloudflare-factory-api` |
| `DOPPLER_FRONTEND_PROJECT` | `cloudflare-factory-frontend` |
| `DOPPLER_WORKFLOWS_PROJECT` | `cloudflare-factory-workflows` |

Environment secrets `DOPPLER_DEPLOY_TOKEN`, `DOPPLER_API_TOKEN`, `DOPPLER_FRONTEND_TOKEN`, and `DOPPLER_WORKFLOWS_TOKEN` are read-only service tokens for those projects' **preview** configs. Cleanup, reconciliation and local access need only the deploy token/project. Do not duplicate tokens at repository scope. GitHub supplies read-only `GITHUB_TOKEN` for provenance checks. Executor credentials are not consumed by the Cloudflare controller.

All app configs require `ENVIRONMENT=dev|preview|prod` matching their config. API additionally requires `API_TOKEN` in prod (at least 20 non-whitespace characters, never the local development token); preview replaces baseline authentication with its HMAC-derived token. Cloudflare frontend/workflows need only `ENVIRONMENT`; resource bindings are generated. Unknown baseline keys are not forwarded to Workers. Portable frontend keys `API_URL` and `PORT` remain app-owned.

The CI project's preview config must contain:

| Key | Meaning |
| --- | --- |
| `ACCOUNT_ID`, `ACCOUNT_NAME`, `CLOUDFLARE_API_TOKEN` | Identity must match independent GitHub variables; account-scoped preview control-plane access |
| `PREVIEW_STATE_BUCKET` | Pre-created private R2 control bucket; never bound to an app or deleted by cleanup |
| `PREVIEW_R2_ACCESS_KEY_ID`, `PREVIEW_R2_SECRET_ACCESS_KEY` | R2 S3 credentials for control state and draining PR buckets |
| `PREVIEW_WORKERS_SUBDOMAIN` | Account subdomain without `.workers.dev`; checked against Cloudflare |
| `PREVIEW_AUTH_SEED` | Cryptographically random seed of at least 32 bytes; generate 32 random bytes encoded as 64 hex characters |

Doppler's downloaded `DOPPLER_PROJECT` and `DOPPLER_CONFIG` must match the independent expected variables. The Cloudflare token needs account read, Workers Scripts, D1, KV, R2 and Queues management permissions. Keep these credentials in a dedicated preview account: account-scoped resource-creation and bucket-cleanup permissions are broad. R2 credentials never enter a Worker. Do not enable public access, lifecycle expiration or external writers on the state bucket.

Bootstrap the state bucket separately using the intended account identity. The CLI will not create it or substitute another bucket. Root dependencies are `effect@4.0.0-rc.112`, `tsx`, `esbuild`, `wrangler`, `@aws-sdk/client-s3`, and `@playwright/test`, pinned by the root lockfile. Ignore `preview-artifact/` in the root gitignore.

## GitHub lifecycle

1. `validation.yml` runs on main pushes and PRs. It starts Docker services, runs strict checks with `PLATFORM_INTEGRATION=1`, `PLATFORM_STORAGE_INTEGRATION=1`, `PLATFORM_WORKFLOW_INTEGRATION=1`, and runs the Compose `browser-tests` service. Preview build reuses that validation.
2. `preview-build.yml` builds PR modules and assets with no deployment environment or secrets. Fork PRs validate but do not upload a deployment artifact.
3. `preview-deploy.yml` runs on the default branch after a successful build. It verifies the run's workflow path, repository, internal PR and current head. Only bundled modules, SQL and ordinary assets cross the artifact boundary; no PR configuration, install hooks or build scripts execute in the privileged job. Trusted Wrangler uses generated configuration and `--no-bundle`.
4. Deployment applies schema, deploys workflows → API → frontend and checks inventory. Authenticated blackbox verification proves note persistence and a completed uppercase job result; Chromium checks the frontend and authenticated same-origin read. No token-bearing traces or screenshots are retained.
5. A secret-free close-event request triggers trusted cleanup. The six-hour reconciler processes closed, expired and partially deleted manifests. Preview expiry is seven days after deployment; it does not close the PR or count bot comments as activity.

Push the controller files to the protected default branch before opening the first smoke PR. A missing or ambiguous `workflow_run` PR association fails closed; use manual cleanup or reconciliation. GitHub can replace pending runs in a concurrency group; reconciliation is the backstop.

## Authorized local Docker access

Set the four `DOPPLER_*_TOKEN` values securely in the host environment, along with `GH_TOKEN` for read-only repository/PR access, `PREVIEW_REPOSITORY=owner/repository`, and the expected account/project variables above. Do not fake `GITHUB_ACTIONS`. Never paste tokens into commands, terminal recordings, PR comments or logs.

Build without deployment credentials:

```sh
docker compose run --rm --no-deps tools npx tsx scripts/preview-build.ts . /workspace/preview-artifact
```

Start one authorized tools shell, forwarding values by name rather than embedding credentials in command arguments:

```sh
docker compose run --rm --no-deps \
  -e DOPPLER_DEPLOY_TOKEN -e DOPPLER_API_TOKEN -e DOPPLER_FRONTEND_TOKEN -e DOPPLER_WORKFLOWS_TOKEN -e GH_TOKEN -e PREVIEW_REPOSITORY \
  -e CLOUDFLARE_ACCOUNT_ID -e CLOUDFLARE_ACCOUNT_NAME \
  -e DOPPLER_DEPLOY_PROJECT -e DOPPLER_API_PROJECT -e DOPPLER_FRONTEND_PROJECT -e DOPPLER_WORKFLOWS_PROJECT \
  tools sh
```

Inside that Docker shell:

```sh
npx playwright install --with-deps chromium
npx tsx scripts/preview-cli.ts deploy --local --pr 123 --artifacts preview-artifact
npx tsx scripts/preview-cli.ts verify --local --pr 123
npx tsx scripts/preview-cli.ts destroy --local --pr 123
npx tsx scripts/preview-cli.ts reconcile --local
```

Use the selected PR's source for local builds; local artifacts do not have GitHub's immutable build-run provenance. `verify` derives its token internally. For explicitly authorized interactive browser access, this command **prints the bearer token** and nothing else on stdout:

```sh
npx tsx scripts/preview-cli.ts token --local --pr 123
```

Token access requires a ready, unexpired ownership manifest. Tokens are HMAC-SHA256 derived from a domain-separated account/repository-ID/PR tuple. They remain stable across pushes and differ between PRs. The seed never enters Worker configuration, artifacts, manifests or logs. Rotating the seed requires redeploying previews before access commands work again.

## Ownership, cleanup and recovery

Names use `cfp-<account/repository hash>-pr-<number>-<kind>`. Manifests live in the private state bucket under immutable account/repository IDs. Every create has a persisted intent first; a pre-existing name without that intent is rejected. Stored names are regenerated and validated, and live IDs must agree before deletion. Do not manually recreate resources under reserved names.

A conditional R2 lock excludes concurrent CI and local mutations. CI jobs are bounded to 30 minutes; an interrupted lock expires after two hours. Never run a local lifecycle process for more than two hours. Missing state authorizes **no deletion**; do not reconstruct ownership from name prefixes alone.

Cleanup disables frontend ingress, removes frontend/API, workflow definition and workflow Worker, verifies DO removal, then drains Queue/R2/KV/D1 resources. R2 cleanup also aborts multipart uploads and checks individual deletion failures. Data is retained while compute deletion is incomplete. Failed cleanup keeps its manifest and is retryable; deleted manifests remain as tombstones. Resource absence, not a green request response, determines completion.

## Optional extensions

Both flags default off. Hyperdrive requires a verified empty-database provisioner; Sandbox requires explicit paid consent and an immutable image. Missing prerequisites fail before provisioning. These paths require separate live sign-off; the default preview tests do not establish optional-provider readiness.

- Hyperdrive requires `PREVIEW_HYPERDRIVE=true`, `PREVIEW_DATABASE_PROVISIONER_URL` and `PREVIEW_DATABASE_PROVISIONER_TOKEN`. The HTTPS provisioner protocol is `GET/PUT/DELETE <base>/<deterministic-name>`; absence is 404. PUT must idempotently create an independent empty database, never clone or attach an existing database. It receives `schemaVersion:"notes-v1"` and must apply the trusted notes schema (`id`, `text`, `created_at`) before reporting ready. GET and PUT responses must include exact `name`, identical `id`, `owner`, `independent:true`, `source:"empty"`, `schemaVersion:"notes-v1"`, and PostgreSQL `origin` fields. GET repeats ownership and origin; DELETE revokes credentials and removes the database. Runtime migrations are not run. Both data Workers receive `HYPERDRIVE`, selecting the request-scoped PostgreSQL adapter; D1 remains independently provisioned.
- Sandbox requires `PREVIEW_SANDBOX=true`, `PREVIEW_ALLOW_PAID_SANDBOX=true`, and `PREVIEW_SANDBOX_IMAGE` pinned to an immutable Cloudflare registry digest. It plans one container maximum and a separate DO, bound to the workflows entrypoint's `Sandbox` export. No Dockerfile from a PR is built with credentials. The default note job does not exercise sandbox execution; validate it separately before enabling it for users.

## Official references

- [Cloudflare binding configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 create API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/)
- [Worker deletion and associated DO removal](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/)
- [R2 bucket emptying and deletion](https://developers.cloudflare.com/r2/buckets/delete-buckets/)
- [Durable Object namespace inventory](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/)
- [GitHub privileged workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Doppler scoped service tokens](https://docs.doppler.com/docs/service-tokens)
- [Effect v4 source and APIs](https://github.com/Effect-TS/effect-smol/tree/main/packages/effect)

Local test success is not a live deployment result. Initial live sign-off must cover deploy, authenticated behavior and cleanup on the same smoke PR.
