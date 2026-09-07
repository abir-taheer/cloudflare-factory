# Preview environments

Infrastructure uses **Effect 4.0.0-rc.112** for execution and **Zod 4.5.4** for schema-first boundary validation and inferred types. PostgreSQL is the application database locally and when deployed. Local development, builds and verification run in Docker; Cloudflare runtime verification uses actual deployed Workers. No emulators or remote development bindings are used.

## Binding contract

| Entrypoint                                   | Bindings                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/cloudflare-api.ts`             | `HYPERDRIVE` PostgreSQL, `OBJECTS` R2, `CACHE` KV, `JOBS` Queue producer, cross-Worker `WORKFLOW` / `COORDINATOR`, `WORKFLOWS` service, `BETTER_AUTH_SECRET`, `ENVIRONMENT`, `API_URL`, `FRONTEND_ORIGINS`, `EMAIL_FROM`, `EMAIL_DELIVERY` |
| `apps/workflows/src/cloudflare-workflows.ts` | Same data bindings, Queue consumer, `WORKFLOW` class `DemoWorkflow`, `COORDINATOR` class `JobCoordinator`                                                                                                                                  |
| `apps/frontend/src/cloudflare-frontend.ts`   | `ASSETS` from the Vite build in `apps/frontend/dist`; public `runtime-config.json` contains only `API_URL` and `ENVIRONMENT`                                                                                                               |

Every PR receives its own PostgreSQL branch, Hyperdrive, KV, R2, Queue, Workers, Workflow and DO. API and frontend enable `workers.dev` at separate origins; workflows remain private. The API accepts credentialed CORS only from the exact preview frontend origin. The frontend serves assets without an API proxy or service binding. Version preview URLs are disabled. Existing PR data persists between pushes until cleanup; verification signs up a synthetic user and writes synthetic notes and jobs.

## Configuration

Use separate deployment-CI and app Doppler projects, each with **dev/preview/prod** configs. App directories map to their own dev config; the CI project is not a default local scope. App variable names stay the same across environments. No actual project/resource names, account IDs, generated configurations or credentials belong in source control.

GitHub environment **cloudflare-preview** is restricted to the protected default branch. Its secrets are config-scoped read-only tokens `DOPPLER_DEPLOY_TOKEN`, `DOPPLER_API_TOKEN`, `DOPPLER_FRONTEND_TOKEN`, `DOPPLER_WORKFLOWS_TOKEN`. Its independent variables are:

| Variables                                                                                                | Purpose                                                                     |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DOPPLER_DEPLOY_PROJECT`, `DOPPLER_API_PROJECT`, `DOPPLER_FRONTEND_PROJECT`, `DOPPLER_WORKFLOWS_PROJECT` | Expected project for each token; downloaded config must be `preview`        |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCOUNT_NAME`                                                       | Exact allowed account, also verified against Cloudflare                     |
| `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH_ID`                                                               | Dedicated preview project and immutable EMPTY baseline ID; never production |

The CI Doppler config requires:

| Keys                                                       | Purpose                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ACCOUNT_ID`, `ACCOUNT_NAME`, `CLOUDFLARE_API_TOKEN`       | Independent identity match and account-scoped control access                 |
| `RESOURCE_PREFIX`                                          | Naming prefix, 1–16 lowercase letters/digits/hyphens, starting with a letter |
| `STATE_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Pre-created private R2 ownership state and PR bucket cleanup                 |
| `WORKERS_SUBDOMAIN`                                        | Account subdomain, checked live                                              |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH_ID` | Project-scoped Neon API access and independent parent/project match          |
| `NEON_DATABASE_NAME`, `NEON_ROLE_NAME`                     | Explicit existing database and role in the EMPTY baseline                    |

The Cloudflare token requires account read, Workers Scripts, Hyperdrive, KV, R2, Queues, and Workflows management. Control state must have no public access or expiry policy. The controller never creates/deletes the state bucket or upgrades provider plans.

App configs require matching `ENVIRONMENT`. The API preview baseline requires `BETTER_AUTH_SECRET` (at least 32 characters) and `EMAIL_FROM`. The controller derives an isolated per-PR session signing key from that app secret and immutable account/repository/PR context; the base secret never reaches a Worker. It overlays `API_URL`, the exact `FRONTEND_ORIGINS`, and `EMAIL_DELIVERY=capture`. Frontend/workflows preview baselines require `ENVIRONMENT`. Production API/frontend baselines also require `API_URL`; production API requires `FRONTEND_ORIGINS`. Unknown baseline keys are not forwarded. Executor tokens are not consumed by this controller.

Preview email capture uses the owned private `OBJECTS` bucket: `auth-email/<SHA256(trimmed-lowercase-recipient)>/<randomUUID>.json`, containing `{to,subject,text}`. The controller validates bucket ownership, recipient and verification-link origins before using the message. There is no public inbox route. Capture delivery is forbidden in prod. Cleanup and local verification need only the deploy token plus independent identity settings and GitHub access; database cleanup also needs the Neon settings.

## Database composite actions

`.github/actions/provision-preview-database` is the provider swap point. It accepts `mode: preview|prod` and `output-file`, an absolute runner-temp path ending in `/handoff.json`. Its `handoff-file` output contains **only the file path**. The Neon implementation lives in `scripts/shared/database/neon-*.ts`; replace that adapter/action implementation for a PostgreSQL provider such as PlanetScale. Core Hyperdrive and cleanup code consume the vendor-neutral contract.

Before creation, persist a random intent nonce with the owner, provider project and immutable parent ID. Neon checks the baseline's inherited databases contain no application tables, explicitly forks with `parent-schema`, creates a minimal compute using the plan's default suspension behavior, and rotates the inherited role password. Provider annotations must match the saved intent and owner. Existing names without matching ownership are rejected; missing known branches or replaced endpoints fail closed. No external provisioner webservice or per-PR Doppler config is needed.

The typed handoff in `scripts/shared/database/database-schema.ts` contains `version`, `owner`, `name`, `identity`, and `directUrl`. Owner includes account/repository IDs, environment and PR (null for prod). Identity includes provider, project, parent branch, intent nonce, branch, endpoint and hostname. The consumer checks every field against private state, requires direct PostgreSQL TLS, and rejects pooled/redirected connections. Identity alone is persisted; credentials never enter manifests or artifacts. Temporary files use mode 0600; Actions masks URL/password and deletes the handoff even on failure.

Trusted Drizzle migrations run before Hyperdrive through `@factory/platform/migrate`. The subprocess receives only `DATABASE_URL` and minimal process settings, with no Cloudflare, Doppler or GitHub credentials. Migrations come from trusted controller code, not PR artifacts. Schema changes must reach the controller before dependent previews.

`.github/actions/cleanup-preview-database` is the corresponding provider cleanup swap point. It processes only deleting manifests whose Cloudflare resources are all confirmed absent. Production uses its separate persistent state and does not run preview cleanup; see [production deployment](production.md).

## CI lifecycle and recovery

1. `validation.yml` validates main and PRs with Docker services, strict checks, all integration flags and browser tests. `preview-build.yml` reuses validation and produces only bundled modules/assets without secrets. Forks do not upload deployable artifacts.
2. Trusted default-branch `preview-deploy.yml` checks build provenance and the exact current internal PR head, then runs the database composite before Hyperdrive and app deployment. It never executes PR build hooks/configuration with credentials.
3. Deploy runs workflows → API → frontend, checks inventory, then verifies normal signup, denied unverified login, captured email verification, session login, note persistence and a **completed uppercase job payload**, plus Chromium frontend behavior and signout denial. It rechecks the head before each Worker and before marking ready. No credentials, cookies, email links or browser traces/screenshots are logged.
4. Close-event cleanup removes ingress and compute, confirms DO/container absence, then removes data bindings including Hyperdrive. Only then does the database composite delete the exact owned branch and confirm absence. Failed cleanup retains state and data needed for retry.
5. Six-hour reconciliation runs both Cloudflare cleanup and the database cleanup composite for closed, expired or partially deleted previews. Expiry is seven days after provisioning; it never closes a PR. Failed deployments retain ownership intent for retries/reconciliation.

Names derive from `RESOURCE_PREFIX`, an account/repository hash, PR and resource kind. Private state uses immutable account/repository IDs. A conditional R2 lock serializes local and CI mutations; CI jobs are bounded to 30 minutes and interrupted locks expire after two hours. Missing state authorizes no deletion. Keep names/IDs stable; do not manually recreate resources under reserved names. Version-2 PostgreSQL manifests reject legacy manifests; clean any legacy resources with their original trusted controller before switching.

## Authorized local Docker smoke

Host environment: config-scoped Doppler tokens and matching project/account/Neon variables above, `GH_TOKEN`, `REPOSITORY`, and `PR`. Forward values by name; never embed secrets in commands. Do not fake GitHub environment variables.

Build without credentials:

```sh
docker compose run --rm --no-deps tools npx tsx scripts/build/preview-build-cli.ts . /workspace/preview-artifact
```

Start the tools shell:

```sh
docker compose run --rm --no-deps \
  -e DOPPLER_DEPLOY_TOKEN -e DOPPLER_API_TOKEN -e DOPPLER_FRONTEND_TOKEN -e DOPPLER_WORKFLOWS_TOKEN \
  -e DOPPLER_DEPLOY_PROJECT -e DOPPLER_API_PROJECT -e DOPPLER_FRONTEND_PROJECT -e DOPPLER_WORKFLOWS_PROJECT \
  -e CLOUDFLARE_ACCOUNT_ID -e CLOUDFLARE_ACCOUNT_NAME \
  -e NEON_PROJECT_ID -e NEON_PARENT_BRANCH_ID -e GH_TOKEN -e REPOSITORY -e PR tools sh
```

Inside Docker:

```sh
export DATABASE_OUTPUT_FILE="$(mktemp -d /tmp/database-handoff.XXXXXX)/handoff.json"
npx playwright install --with-deps chromium
npx tsx scripts/preview/database/preview-neon-cli.ts provision --local
npx tsx scripts/preview/preview-cli.ts deploy --local --pr "$PR" --artifacts preview-artifact
npx tsx scripts/preview/preview-cli.ts verify --local --pr "$PR"
npx tsx scripts/preview/preview-cli.ts destroy --local --pr "$PR"
npx tsx scripts/preview/database/preview-neon-cli.ts cleanup --local
rm -f "$DATABASE_OUTPUT_FILE"
```

Use `npx tsx scripts/preview/preview-cli.ts verify --local --pr "$PR"` for authorized testing: it creates and verifies a normal session internally without printing passwords, cookies or verification links. Open the reported frontend URL to inspect the public UI. There is no bearer-token command or fallback. Rotating the API baseline session secret requires redeployment. To reconcile locally, run `npx tsx scripts/preview/preview-cli.ts reconcile --local` followed by `npx tsx scripts/preview/database/preview-neon-cli.ts cleanup --local`. Local artifacts lack GitHub build-run provenance: build the intended PR checkout first.

## Optional Sandbox

Sandbox alone is opt-in: `SANDBOX_ENABLED=true`, `ALLOW_PAID_SANDBOX=true`, and `SANDBOX_IMAGE` pinned to a trusted immutable Cloudflare registry digest. It adds one container and a separate DO owned by the workflows Worker. Missing prerequisites fail closed. The note job does not verify sandbox execution; validate that separately before enabling it.

## Official references

- [Neon create branch and immutable parent selection](https://api-docs.neon.tech/reference/createprojectbranch)
- [Neon API schema and schema-only branching modes](https://neon.com/api_spec/release/v2.json)
- [Neon direct connection URI](https://api-docs.neon.tech/reference/getconnectionuri)
- [Neon delete branch and operation completion](https://api-docs.neon.tech/reference/deleteprojectbranch)
- [Cloudflare binding configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [GitHub privileged workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Doppler config-scoped service tokens](https://docs.doppler.com/docs/service-tokens)

Static checks and local service tests do not establish live provider readiness. Sign off only after branch → Hyperdrive → apps → authenticated browser verification → complete cleanup succeeds on the same smoke PR.
