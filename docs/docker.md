# Portable Docker images

Development stays in independent containers: `docker compose up --build --wait`.
The host frontend is `http://localhost:5174` (`FRONTEND_PORT` overrides the port),
and the separate API is `http://localhost:8787`. No frontend API proxy or local
Cloudflare runtime is involved.

## Optional per-app Doppler development

Use the official host Doppler CLI with an authenticated local login. Set private
`DOPPLER_API_PROJECT`, `DOPPLER_FRONTEND_PROJECT`, `DOPPLER_WORKFLOWS_PROJECT` shell variables to three distinct app projects. Each must
have a `dev` config; never use the deployment-CI project or token.

Bootstrap each complete dev config from that service's `environment` in
`compose.yaml`, including inherited `x-app.environment` for API and workflows.
Resolve the frontend port to the same `FRONTEND_PORT` used by Compose. Copy only
that app's settings; Doppler supplies its project/config/environment metadata.
Initially only API `BETTER_AUTH_SECRET` and `EMAIL_FROM` may differ from Compose. Tokens require at least 32 URL-safe
letters, digits, underscores or hyphens; the sender must be a valid email address.
All provider URLs, database credentials, namespaces, ports and public origins
must remain the Docker defaults. This keeps migration and application databases
identical. Existing typed app configuration validation also runs at startup.

```sh
bash scripts/development/doppler_development.sh
```

The host runs only Doppler and Docker orchestration; validation and app runtime
run in Docker. `npm run dev:doppler` is an optional shell-command alias. The
explicit `compose.doppler.yaml` overlay clears inherited environment settings and
loads one required env file per app. No Doppler CLI or token enters app images.
Fresh downloads use `0600` files in an ignored `0700` `.local` subdirectory, removed
on exit. No downloaded values are printed. An official JSON download is compared
with Compose's parsed dotenv settings before services start; interpolation or a
rotation between downloads fails closed. No cached config is used. Re-run the
script to refresh settings; ordinary `docker compose down` stops the services.

Verify synthetic quotes, literal dollars, backslashes and multiline dotenv values
with `bash scripts/development/test_dotenv_roundtrip.sh` after building the
development image. Boundary tests run in `npm run check`. The synthetic test proves
Compose parsing; the per-run JSON comparison checks actual Doppler export fidelity.
See [Doppler downloads](https://docs.doppler.com/docs/accessing-secrets) and
[Compose reset semantics](https://docs.docker.com/reference/compose-file/merge/).

## Runtime images

Build one runtime independently with `docker build --target api -t factory-api:local .`.
The other targets are `frontend` and `workflows`. Each runs compiled
JavaScript without source mounts or `tsx`. Frontend startup validates `API_URL`,
`ENVIRONMENT`, and `PORT` and serves public configuration in memory; build assets
contain no deployment credentials.

For runtime-image blackbox checks, stop the development app containers first to
free their host ports, then use a separate project with fresh database volumes:

```sh
docker compose stop api frontend workflows
docker compose -p factory-runtime-check -f compose.yaml -f compose.test.yaml up --build --wait --wait-timeout 240
docker compose -p factory-runtime-check -f compose.yaml -f compose.test.yaml run --rm browser-tests
docker compose -p factory-runtime-check -f compose.yaml -f compose.test.yaml down --volumes
```

Only the isolated check project's volumes are removed by the last command.
The browser's dependency initialization service populates empty root and workspace
dependency volumes from the lockfile-built tooling image; no earlier `tools` run
or host `node_modules` is required. After changing dependencies, run
`docker compose run --rm --no-deps tools npm ci` to update those volumes in Docker.
The test override shares the API network namespace with frontend and browser
containers. Both host and Docker browsers use the same localhost URLs, origins
and cookie behavior. Mailpit remains reachable inside Docker at `mailpit:8025`.
Changing the API container requires recreating the containers sharing its network
namespace. Regular development keeps separate network namespaces.

Dependency layers copy workspace manifests and the lockfile before sources, with
an npm BuildKit cache mount. CI exports separate app cache scopes; its exported
layers do not automatically persist npm cache mounts. App build stages copy only
that app and shared packages. Private configuration and generated artifacts are
excluded from the Docker context. See Docker's [multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[cache guidance](https://docs.docker.com/build/cache/optimize/), and
[Compose network modes](https://docs.docker.com/reference/compose-file/services/#network_mode).

The Node bundler bundles application dependencies except Temporal worker runtime
packages. Temporal workflows use the SDK's `bundleWorkflowCode` at build time and
`workflowBundle` at startup, with the exact same SDK version. The workflow image
retains the lock-resolved declared production dependency closure, including native
bridge and worker-thread files, on Linux glibc. Prebundling removes startup
compilation; it does not authorize deleting declared compiler dependencies. See
[Temporal bundle requirements](https://typescript.temporal.io/api/interfaces/worker.WorkerOptions#workflowbundle)
and [esbuild external packages](https://esbuild.github.io/api/#external).

Pinned `api-slim`, `frontend-slim`, and `workflows-slim` comparison targets
allow measuring the same app artifacts against alternative runtimes. Compare
`docker image inspect --format '{{.Size}}' IMAGE` on the same architecture;
reported bytes are local unpacked image sizes, not registry download sizes.
