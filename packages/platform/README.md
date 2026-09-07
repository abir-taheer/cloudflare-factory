# Portable Effect capabilities

Effect is pinned to **4.0.0-rc.112**. All capability keys use `Context.Service<Shape>("@factory/platform/…")` function syntax. Provider methods suspend real I/O inside `Effect.tryPromise` and return `CapabilityError` with capability, operation, and cause. The optional sandbox returns `CapabilityUnavailable` when not configured. There are no production memory or no-op success adapters.

## Entry points

- `@factory/platform`: portable capability contracts only; no provider imports.
- `@factory/platform/demo`: `runNoteJob({id,noteId})` reads the note, uppercases its text, and writes `{id,noteId,status:"completed",content}` to `job/${id}.json`. It returns the result after storage succeeds. Missing notes fail with `NoteDemoNotFound`. Replays overwrite the same artifact.
- `@factory/platform/cloudflare`: `cloudflarePlatformLayer({DATABASE,OBJECTS,CACHE,JOBS,WORKFLOW,COORDINATOR})` plus individual binding layers.
- `@factory/platform/portable`: `portablePlatformLayer(config)` plus individual PostgreSQL, S3, Redis, Temporal, SMTP, and HTTP sandbox layers.

`Database.createNote({id,text,createdAt})` is insert-only; `getNote(id)` returns null when absent. Apply `infra/postgres.sql` or `infra/d1.sql` before traffic. The package migration is identical. API `content` maps to stored `text`; timestamps are caller-supplied ISO strings. Database creation and queue enqueue are separate, nontransactional operations.

## Composition and lifecycle

The portable aggregate acquires PostgreSQL, Redis, S3, Temporal and SMTP clients with `Effect.acquireRelease` inside `Layer.unwrap`. Use a long-lived `ManagedRuntime.make(portablePlatformLayer(config))` at application startup and dispose it at shutdown. Individual adapters accept caller-owned clients and never close those clients. The aggregate provides all required capabilities plus SMTP email; add either `httpSandboxLayer(endpoint, token)` or `unavailableSandboxLayer` explicitly.

Map `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `SMTP_HOST`, `SMTP_PORT`, `TEMPORAL_ADDRESS` to the corresponding camel-case fields in `PortablePlatformConfig`. Also provide a deployment `namespace`, registered `workflowType`, and `taskQueue`. Temporal namespace defaults to `default`; `namespace` prefixes Redis keys, not Temporal namespaces. SMTP supports optional `smtpSecure` and `smtpAuth`. Endpoints and credentials have no ambient production fallback. Redis is pinned to 6.2.1 to match the root.

## Background delivery

Redis stores jobs in `${namespace}:jobs` as Streams entries with a JSON `job` field. `ensureRedisQueueGroup(client,stream,group)` creates a group from `0` with `MKSTREAM` and tolerates only `BUSYGROUP`. `consumeRedisJobs(client,stream,group,consumer,process)` reads up to ten new messages. `reclaimRedisJobs(client,stream,group,consumer,minIdleMs,cursor,process)` recovers idle pending messages and returns the next scan cursor. A callback must resolve only when durable downstream acceptance or processing succeeds. Acknowledgment follows the callback; parsing, processing and transport failures remain pending. Poison jobs need operator inspection or a host-managed dead-letter policy; the adapter does not discard them. Streams are not trimmed automatically.

The Node workflow host uses unique consumer names and pending scans with 30-second minimum idle time. The Temporal adapter uses job IDs as workflow IDs and `REJECT_DUPLICATE`; only `WorkflowExecutionAlreadyStartedError` is treated as previously accepted. Existing failed workflows are still existing executions: their status remains a workflow concern and is not reported as completed by this adapter. Temporal retention bounds deduplication. Jobs require stable, unique IDs; duplicate IDs with different payloads are unsupported.

Cloudflare queue handlers must acknowledge after `Workflow.start`; retries are at least once. Cloudflare workflow entrypoints and Temporal workers live in the host applications. A start result confirms acceptance, not completion.

## Other capability semantics

Object reads buffer whole objects and are for modest note artifacts. Missing objects are null; S3 permission and transport failures remain errors. Cache expiration is an integer number of seconds, minimum 60 for KV parity. KV is eventually consistent and should not be used as an authoritative job ledger.

Coordinator acquire uses expiring ownership tokens. Redis uses SET NX PX and atomic compare-and-delete. Delegate Durable Object RPC methods to `DurableObjectLeaseStorage` from a real `DurableObject` subclass; it uses durable storage transactions, never process memory. Use one object per named lease. Tokens must be unique per acquisition. Leases do not provide fencing, renewal or exactly-once work.

`cloudflareEmailLayer(binding,makeMessage)` calls the real email binding. The host supplies Cloudflare's runtime `EmailMessage` constructor and MIME serialization through `makeMessage`; the portable entrypoint never imports `cloudflare:email`. SMTP rejects unaccepted/rejected recipients. Email acceptance does not prove delivery.

`cloudflareSandboxLayer(handle)` calls a real Sandbox SDK handle's `exec`. `httpSandboxLayer(endpoint,token)` POSTs `{command,timeoutMs}` with bearer authentication to a separately isolated executor and validates `{stdout,stderr,exitCode}`. Nonzero exit status is a result, not fake success. Non-2xx, invalid JSON and unavailable executors fail. The adapters never execute commands on the application host. Timeouts bound waiting; executor-side process termination/isolation must be enforced by the executor. Cloudflare documents that exec timeout does not itself stop the remote process.

## Docker verification

The root owner installs dependencies; do not run concurrent installs.

```sh
docker compose run --rm --no-deps tools npm exec -- tsc --noEmit -p packages/platform/tsconfig.json
docker compose run --rm --no-deps tools npm exec -- oxlint --type-aware --type-check --deny-warnings packages/platform
docker compose run --rm --no-deps tools npm exec -- tsx --test packages/platform/src/platform-capabilities.test.ts
docker compose up -d postgres redis
docker compose run --rm --no-deps -e PLATFORM_INTEGRATION=1 tools npm exec -- tsx --test packages/platform/src/platform-integration.test.ts
```

The integration test uses real Postgres and Redis with unique test IDs, then cleans up only those IDs. Cloudflare remote bindings are not exercised locally. Unit test doubles are confined to test files and exercise failure handling.

## Official API research

- [Effect v4 service migration](https://github.com/Effect-TS/effect-smol/blob/main/migration/services.md): function-style Context.Service and explicit Layer composition.
- [Effect v4 Context source](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Context.ts): key identity and service shape inference.
- [Effect v4 Layer source](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Layer.ts): scoped construction, unwrap and resource lifecycle.
- [Effect v4 authoring guide](https://github.com/Effect-TS/effect-smol/blob/main/LLMS.md): typed failures and provider boundary conventions.
- [Cloudflare sandbox commands](https://developers.cloudflare.com/sandbox/api/commands/): exec request, response and timeout behavior.

API compatibility is additionally checked against the installed pinned Effect release in Docker.

Additional real-service checks (requires MinIO, Mailpit, Temporal and the workflow host):

```sh
docker compose run --rm --no-deps -e PLATFORM_STORAGE_INTEGRATION=1 tools npm exec -- tsx --test packages/platform/src/platform-storage-integration.test.ts
docker compose run --rm --no-deps -e PLATFORM_WORKFLOW_INTEGRATION=1 tools npm exec -- tsx --test packages/platform/src/platform-workflow-integration.test.ts
docker compose run --rm --no-deps -e PLATFORM_INTEGRATION=1 tools npm exec -- tsx --test packages/platform/src/platform-hyperdrive-integration.test.ts
```

Verified in Docker: PostgreSQL persistence and duplicate inserts; Redis TTLs, ownership and failed-message reclaim; S3 missing/read/write/delete and deterministic job replay; SMTP acceptance by Mailpit; real Temporal repeated starts before and after completion with unchanged run ID; scoped runtime disposal; Hyperdrive adapter connections against local PostgreSQL. Eight tests pass with all integration flags enabled. A dedicated worker SIGTERM check reached STOPPING → DRAINING → DRAINED → STOPPED before process exit (NodeRuntime's interruption exit code is 130). Native Temporal connection acquisition retries every two seconds; worker creation retries ten times; shutdown allows ten seconds of grace and forces termination after twenty seconds, awaiting completion before closing native connections.

## Lease, cache and optional Hyperdrive execution

`runNoteJob` now requires `Coordinator` and `KeyValue` as well as `Database` and `ObjectStore`. It acquires a 60-second lease keyed by the exact job ID with a fresh UUID token for every attempt. Contention fails with `NoteJobContended`; ownership-checked release runs on success, failure and interruption. An expired lease fails with `NoteJobLeaseLost`. Leases still are not fencing: deterministic artifact writes make replay safe after expiry.

The job reads `note/${noteId}` from KV/Redis, validates its schema and note ID, falls back to the immutable database record on malformed/missing cached content, and caches a database read for 300 seconds. Cache provider failures are typed errors rather than silently bypassing the capability. The Redis/S3 integration test verifies contention, release, malformed-cache fallback, TTL and cache-only replay while preserving the output shape.

An optional `HYPERDRIVE: {connectionString}` binding selects `hyperdriveDatabaseLayer` in `cloudflarePlatformLayer`. There is no fallback to D1 if that binding is present but broken. Build/provide this layer per request or workflow step; never retain it in an isolate-global ManagedRuntime. The adapter uses a new scoped `pg.Client` and closes it when the Effect scope ends. The pinned pg 8.23.0 exceeds Cloudflare's required 8.16.3. Cloudflare bundles now intentionally include the pg driver for this opt-in path, but not the portable aggregate or Redis, Temporal, S3 SDK or SMTP runtime.

The external database provisioner must apply the trusted notes migration before returning `schemaVersion: "notes-v1"`; deployment must validate that attestation before creating the Hyperdrive binding. Runtime handlers never create tables or migrate schemas. The local integration test exercises this adapter against real PostgreSQL, including distinct backend PIDs per request and cleanup after failure; it does not provision or claim to test a paid Cloudflare Hyperdrive deployment.

Official reference: [Hyperdrive PostgreSQL driver example](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/) and [connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).
