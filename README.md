# Cloudflare Factory

A bootstrapped template for building and shipping real products with coding agents. Start from working authentication, a themeable frontend, typed APIs, a database and background jobs. Agents build features on branches, exercise them in isolated PR environments, then merge verified work into the product's default branch.

The Node monorepo uses Effect v4, Zod 4.5, PostgreSQL and Drizzle for the API, and React/Vite, MUI, TanStack Query and an OpenAPI-generated client for the frontend. Better Auth includes verified-email signup, sessions and password reset. The notes/workflow feature is a working example to extend or replace with your product's domain.

## Develop

Agents: start with [AGENTS.md](./AGENTS.md) and the [agent workflow](./docs/agent_workflow.md) for the change → Docker checks → PR preview → verification loop.

```sh
docker compose up --build --wait
docker compose run --rm --no-deps --build tools npm run check
```

Open [the frontend](http://localhost:5174), create an account, and open its verification email in [Mailpit](http://localhost:8025). The API runs separately at `http://localhost:8787`. Development credentials are disposable fixtures; deployment requires explicit configuration.

All local services run in Docker: PostgreSQL, Redis, S3-compatible storage, SMTP and Temporal. No native Cloudflare runtime or remote binding is used locally. `docker compose down` preserves data. See [Docker images and blackbox tests](./docs/docker.md) for independent app builds, dependency updates and isolated runtime-image checks.

## Layout

- `apps/api`: typed HTTP routes and authentication.
- `apps/frontend`: themeable SPA and static delivery; no API proxy.
- `apps/workflows`: Cloudflare and Temporal hosts for shared domain jobs.
- `packages/platform`: provider-neutral capabilities, adapters and generated database migrations.
- `packages/auth`: shared Better Auth configuration and email delivery.
- `packages/api-contract` and `packages/api-client`: Zod contracts, OpenAPI and generated client types.
- `packages/lint-rules`: shared code-quality rules and their behavioral tests.
- `scripts/build`, `scripts/preview`, `scripts/production` and `scripts/shared`: deployment entrypoints and supporting modules grouped by responsibility.

## Deploy and customize

[Preview environments](./docs/preview_environments.md) use an empty database branch and new Cloudflare resources for each PR. Database provisioning is a separate composite action, followed by Hyperdrive creation. Production data is never a preview source or fallback.

[Production deployment](./docs/production.md) uses named GitHub environments and per-app Doppler projects, with CI credentials in a separate project. Runtime settings retain the same names across dev, preview and prod. Resource names, IDs, credentials and rendered Wrangler configuration stay outside tracked code.

Replace provider Layers at the composition root to self-host; domain code does not require Worker bindings. See [provider contracts](./docs/providers.md), [Effect and validation guidance](./docs/effect_v4.md), and the [frontend guide](./apps/frontend/README.md). Optional sandbox capabilities connect to external providers; no command-execution app runs alongside the product.
