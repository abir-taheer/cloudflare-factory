# Effect v4 conventions

Use the exact Effect v4 versions in the workspace manifests. The unversioned documentation may redirect to v3; start with the [v4 reference](https://effect.website/docs/v4/api).

## Validation and HTTP

Use **Zod 4.5** for every schema, including environment variables, requests, provider responses and deployment state. Effect Schema is forbidden. Name schemas `PascalCaseSchema`, derive types with `z.infer`, and validate unknown values with `safeParse`. Map invalid secret-bearing configuration to a sanitized tagged error instead of retaining parser input.

The API uses Hono and Zod OpenAPI: one operation per route file, named shared contracts, and an Effect execution boundary. Keep domain operations independent of HTTP responses. The frontend consumes generated contracts and query hooks.

## Services and errors

Declare provider-neutral contracts with `Context.Service<ServiceShape>("unique/service/key")`. Compose implementations with Layers. Do not import Cloudflare bindings or Node client types into domain contracts.

- `Layer.succeed` supplies an existing implementation.
- `Layer.effect` builds a service from dependencies.
- `Layer.provide` wires dependencies; `Layer.mergeAll` combines independent providers.
- `Effect.acquireRelease` owns client lifetimes. Node pools live with the application; Hyperdrive clients live within one request or workflow step.

Use `Data.TaggedError` for typed failures. Wrap throwing SDK calls with `Effect.try` or `Effect.tryPromise`, preserve cancellation, and translate provider failures into public errors without raw causes. Use `Effect.catchTag` for selective recovery; never convert cancellation or programmer defects into success.

Run Effects only at documented application, callback, CLI and test boundaries. Keep service operations as Effects. Use named spans, bounded retries and timeouts; do not log payloads, authentication links, SQL parameters or credentials.

## Runtime ownership

Node entrypoints own service startup and shutdown. Dispose managed runtimes and all acquired clients. Worker bindings and execution contexts remain request-local. Await required work; use queues or workflows for durable delivery. `waitUntil` is bounded background execution, not a durable queue.

Local execution and verification use Docker with PostgreSQL, Redis, S3-compatible storage, SMTP and Temporal. Never use Wrangler dev, Miniflare, workerd or native Cloudflare bindings locally.

## Quality gate

Run `docker compose run --rm tools npm run lint` before feature work and `npm run check` before pushing. Prettier, strict Oxlint, the imported rule tests and repository checks are mandatory. The [lint rule inventory](../packages/lint-rules/README.md) documents the source rules and narrowly scoped exceptions; do not weaken checks to make new code pass.

References: [Effect service migration](https://github.com/Effect-TS/effect/blob/main/migration/services.md), [Effect v4 error handling](https://github.com/Effect-TS/effect/blob/main/migration/error-handling.md), [Zod validation](https://zod.dev/basics), [Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi).
