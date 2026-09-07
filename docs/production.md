# Independent production deployments

Use only `dev`, `preview` and `prod`. Production uses PostgreSQL through Hyperdrive, never D1 or a preview database. The manual **Production deploy** workflow accepts `api`, `frontend`, `workflows`, or `all`. It runs only on current `main`, deploys only the selected app, and verifies its production behavior. Use `all` for the initial dependency-ordered bootstrap. This workflow does not deploy the local Docker executor.

## Protected configuration

Create the GitHub environment `cloudflare-prod`, restrict it to `main`, and require release approval. Use four distinct Doppler projects: deployment CI, API, frontend, and workflows. Each uses a `prod` config; preview uses separate config values and a separate database project. There is no staging config.

Configure these **named-environment secrets** in `cloudflare-prod`; private identity values must be masked in Actions step logs:

- `DOPPLER_DEPLOY_TOKEN`, `DOPPLER_API_TOKEN`, `DOPPLER_FRONTEND_TOKEN`, `DOPPLER_WORKFLOWS_TOKEN`: read-only, config-scoped Doppler tokens for their respective projects.

- Corresponding `DOPPLER_DEPLOY_PROJECT`, `DOPPLER_API_PROJECT`, `DOPPLER_FRONTEND_PROJECT`, `DOPPLER_WORKFLOWS_PROJECT`.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCOUNT_NAME`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH_ID`. The independently configured project/parent values must match the CI Doppler config.

Runtime environment key names stay unchanged. Workflows read these values only from `secrets`, with no `vars` fallback. Populate the environment secrets before running the migrated workflow, then remove the superseded private variables. Keep actual values out of source control. Public preview domain names remain variables in `cloudflare-preview`; this production workflow does not consume those preview pins.

The CI project's `prod` config requires:

| Key                                                                                                | Purpose                                                                                                  |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                                                                                      | `prod`                                                                                                   |
| `ACCOUNT_ID`, `ACCOUNT_NAME`, `CLOUDFLARE_API_TOKEN`                                               | Exact production account and narrowly scoped management credential                                       |
| `RESOURCE_PREFIX`                                                                                  | Production-only namespace for generated resource names; lowercase, starts with a letter, 3–40 characters |
| `STATE_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                         | Separately provisioned private production ownership state; never bound to applications                   |
| `WORKERS_SUBDOMAIN`                                                                                | Actual account subdomain, checked against Cloudflare before sending test credentials                     |
| `RESOURCE_INVENTORY_JSON`                                                                          | Object with exactly `cache`, `objects`, and `jobs`; each contains the actual resource `name` and `id`    |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH_ID`, `NEON_DATABASE_NAME`, `NEON_ROLE_NAME` | Provider-specific inputs to the replaceable database action                                              |

The registered cache, object bucket, and queue names must equal `RESOURCE_PREFIX` with the corresponding `-cache`, `-objects`, or `-jobs` suffix. The bucket ID equals its name. Provision these resources separately and register their exact identities; the controller does not adopt resources by discovery. Keep state storage and application object storage distinct.

Each app project's `prod` config requires `ENVIRONMENT=prod`. API and frontend configs require `API_URL` matching the generated public API origin; the API also requires `FRONTEND_ORIGINS` equal to the generated frontend origin. The API additionally requires `BETTER_AUTH_SECRET` and `EMAIL_FROM`. Only the auth secret is uploaded as a secret binding; public origins and sender configuration are projected explicitly. Frontend and workflows deployments fetch only their respective app Doppler tokens. Production smoke uses no authentication credential and creates no users or application data.

## Database ownership and migrations

The reusable `.github/actions/provision-preview-database` action runs with `mode: prod` before Hyperdrive creation. Its name is historical; its contract supports both environments. Neon-specific provisioning is isolated in the action's provider runner. A future PlanetScale action can implement the same private handoff and persisted identity without changing application code or the deployment controller.

Use distinct Neon projects for the empty preview baseline and persistent production data. A new production branch starts from its own verified empty baseline. Subsequent deployments recover the same annotated branch using a nonce persisted before creation; they never refork, reset, or delete production data. Project/parent drift, missing owned resources, and foreign annotations fail closed. No paid-plan upgrade is performed; exhausted free-tier capacity fails the workflow.

The action outputs only a private file path. The version-1 file contains `owner`, `name`, nested provider `identity`, and `directUrl`. Its owner must be the exact account/repository with `environment: prod` and `pr: null`. The file must be regular, mode `0600`, and match persisted identity. It is mounted into the deploy container and deleted in an `always()` step. Never upload it, export its URL as an action output, or copy it into artifacts.

The controller checks committed Drizzle migration SQL against an additive allowlist, then executes the trusted PostgreSQL migration entrypoint in a subprocess receiving only `DATABASE_URL` and `PATH`. Tables, indexes and added columns are allowed; destructive or executable statements fail. Application startup does not run migrations. Review schema changes for compatibility with the previous app version; the deployment is not a cross-service transaction and does not undo schema/data changes on failure.

Hyperdrive receives only the validated direct PostgreSQL origin, with caching disabled and verified TLS. Existing TLS, cache and connection-limit settings must still match; drift fails closed. Its newly created ID is stored privately. An uncertain create that was not checkpointed requires operator reconciliation of the exact owned resource into private state; the controller will not adopt an existing name blindly.

## Release and verification

1. Keep production resource identifiers and names in GitHub/Doppler or private state, not source, docs, or Wrangler files. Wrangler configurations are generated under `/tmp` and removed after upload.
2. Dispatch from `main`, select one app, and leave `allow_create` false for routine releases. First bootstrap requires separately registered data resources, `all`, and explicit `allow_create=true`.
3. A credential-free job tests the selected applications against Docker services and builds their artifacts. The protected job builds trusted tooling before receiving secrets and downloads only this run's artifact. Provenance must match the selected app, repository ID and unchanged main SHA.
4. Only bundled modules/static assets are uploaded. No artifact code, package hooks or application build commands run with deployment credentials. Runtime secrets are projected from only the selected app's config. The frontend Vite build is credential-free; the trusted deploy step copies validated assets into its private temporary directory and writes public `runtime-config.json` containing only `API_URL` and `ENVIRONMENT`.
5. Successful release requires owner/revision and ingress readback plus HTTP verification. Frontend checks HTML/security headers and exact-origin API CORS; API checks health/readiness, OpenAPI availability, CORS and unauthenticated denial. Workflows checks its owner/release and private ingress, plus dependent API readiness; this does not prove an authenticated end-to-end job. API and frontend are separate public origins on the validated account subdomain; workflows remain private. The frontend has only an assets binding, no API service binding or proxy. Do not attach out-of-band zone routes.

Independent deployments require their dependencies already deployed; use `all` for first bootstrap. Production verification is read-only; authenticated user/job tests require separate explicit authorization. Failures do not trigger destructive cleanup or automatic rollback. Correct the issue and deploy a reviewed main revision; ordinary releases preserve resource identities.

Local checks, without production credentials or Worker emulators:

```sh
docker compose run --rm tools sh -ec 'npx oxlint --type-aware --type-check --deny-warnings scripts'
docker compose run --rm tools sh -ec 'node --import tsx --test scripts/production/*.test.ts'
```

Sources: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/), [Hyperdrive configuration](https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/get/), [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
