# Portable capabilities

Effect `4.0.0-rc.112` provides function-style `Context.Service` keys, typed failures, tracing, and scoped layers. Serializable contracts use Zod `4.5.4` schemas and inferred types. Provider failures return `CapabilityError`; an unconfigured optional sandbox returns `CapabilityUnavailable`.

## Entry points

| Import                            | Purpose                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `@factory/platform`               | Portable contracts and schemas; no provider imports                              |
| `@factory/platform/demo`          | `runNoteJob` and the stored job-result schema                                    |
| `@factory/platform/cloudflare`    | Hyperdrive, R2, KV, Queue, Workflow, Durable Object, email, and sandbox adapters |
| `@factory/platform/portable`      | PostgreSQL, S3, Redis, Temporal, SMTP, and HTTP executor adapters                |
| `@factory/platform/postgres`      | Drizzle factory for caller-owned PostgreSQL clients                              |
| `@factory/platform/auth-schema`   | Generated Better Auth tables and relations                                       |
| `@factory/platform/migrate`       | Trusted PostgreSQL migration runner                                              |
| `@factory/platform/capture-email` | Private object-store email capture for isolated environments                     |

## Database and migrations

PostgreSQL is the only database dialect. Drizzle ORM/Kit `1.0.0-rc.4` and `pg` `8.23.0` run PostgreSQL queries inside Effect adapters with JIT row mapping disabled. `Database.createNote({id,ownerUserId,text,createdAt})` is insert-only. `getNote(id,ownerUserId)` returns null for missing notes or another owner's note. Notes reference the auth user with cascading deletion; `createdAt` is caller-supplied ISO text.

Better Auth's CLI generates the auth schema, including database-backed rate limits. Drizzle Kit generates SQL migrations from that schema and the note schema. Never handwrite migration SQL or run migrations in request handlers.

```sh
docker compose run --rm --no-deps tools npm run auth:generate --workspace @factory/platform
docker compose run --rm --no-deps tools npm run db:generate --workspace @factory/platform
docker compose run --rm --no-deps -e DATABASE_URL tools npm run db:migrate --workspace @factory/platform
```

Set `DATABASE_URL` explicitly to the intended isolated database before migration. The initial generated migration requires an empty database; existing unmanaged tables are not adopted. Repeated migration runs use Drizzle's journal. Preview provisioning must migrate an isolated Neon branch from an empty baseline, never production data.

## Configuration and lifecycle

`cloudflarePlatformLayer` requires `HYPERDRIVE`, `OBJECTS`, `CACHE`, `JOBS`, `WORKFLOW`, and `COORDINATOR`. Build it per request or workflow step. Hyperdrive creates and closes one `pg.Client` per Effect scope; keep the awaited auth handler inside that scope when using `acquireHyperdriveDrizzle`.

`portablePlatformLayer(config)` scopes PostgreSQL, Redis, S3, Temporal, and SMTP clients. Dispose its `ManagedRuntime` at shutdown. Individual adapters leave caller-owned clients open. Hosts map these explicit environment settings into `PortablePlatformConfig`:

- `DATABASE_URL`, `REDIS_URL`
- `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`
- Optional `S3_REGION` (default `us-east-1`) and `S3_FORCE_PATH_STYLE` (`true`/`false`, default `true`). Set path style to `false` for virtual-hosted bucket addressing.
- `SMTP_HOST`, numeric `SMTP_PORT`; optional `SMTP_SECURE` and `SMTP_REQUIRE_TLS` (`true`/`false`, default `false`), plus paired `SMTP_USERNAME`/`SMTP_PASSWORD`. Credentials require at least one TLS flag. Use secure TLS on 465 or required STARTTLS on 587. Certificate verification remains enabled; a failed upgrade never falls back to plaintext authentication.
- `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`
- Optional `TEMPORAL_TLS` (`true`/`false`), `TEMPORAL_API_KEY`, `TEMPORAL_TLS_SERVER_CA_CERT_DATA`, paired `TEMPORAL_TLS_CLIENT_CERT_DATA`/`TEMPORAL_TLS_CLIENT_KEY_DATA`, and `TEMPORAL_TLS_SERVER_NAME`. Certificate values contain raw PEM. Both client and worker use the same settings. Credentials or TLS material enable TLS when the flag is absent; explicit `false` with those settings is rejected. With none supplied, local Docker remains plaintext. Server-name overrides change the expected verified hostname; certificate verification cannot be disabled. File paths and SDK profile fallbacks are not loaded.
- `PLATFORM_NAMESPACE` and the registered `workflowType`

The platform namespace prefixes Redis keys. Endpoint and credential configuration has no production fallback. Email and sandbox capabilities are supplied explicitly on Cloudflare; the portable aggregate supplies SMTP, with the HTTP executor or unavailable sandbox layer added separately. Captured authentication emails are private objects and must never be exposed through public object routes.

## Job behavior

`runNoteJob({id,noteId,ownerUserId})` acquires a 60-second lease keyed by `id` with a fresh attempt token. Contention is a typed retryable failure; release checks ownership on success, failure, and interruption. Leases do not provide fencing or renewal.

The job validates cached notes at `note/${encodeURIComponent(ownerUserId)}/${noteId}`, falls back to an owner-scoped database read for missing or malformed content, and caches that immutable note for 300 seconds. It writes `{id,noteId,ownerUserId,status:"completed",content:note.text.toUpperCase()}` to `job/${id}.json`. Replays overwrite the same artifact; completion is returned only after storage succeeds.

Redis queue consumers use stream groups: `ensureRedisQueueGroup`, `consumeRedisJobs`, and `reclaimRedisJobs`. Acknowledgment follows successful downstream processing or durable acceptance; failures remain pending for recovery. Streams are not automatically trimmed. Temporal uses the job ID as workflow ID and accepts only its known already-started error as a duplicate. Workflow start confirms acceptance, not job completion.

Object reads buffer modest artifacts; missing objects return null. KV is eventually consistent, with a minimum 60-second cache TTL. SMTP and Cloudflare email acceptance do not guarantee delivery. Sandbox adapters call the real Cloudflare SDK or the trusted Docker HTTP executor; command execution never runs inside the application host.

## Managed sandbox

`@factory/platform/managed-sandbox` exports a separate `ManagedSandbox` service, schemas and provider interface. `open({ttlMs})` requires an Effect scope and returns an opaque UUID plus `execute`, `readFile` and `writeFile`. File requests use workspace-relative paths and one-MiB byte limits. Persist IDs only, never session handles. Commands can modify their own sandbox workspace.

`@factory/platform/cloudflare-managed-sandbox` supplies the real SDK RPC adapter. Configure an exclusive private namespace. Scope release destroys only the acquired UUID; `destroy(id)` supports recovery within that namespace. Cleanup failures fail scope closure. The live scope enforces TTL, while Cloudflare's one-minute idle sleep is a separate safeguard, not a durable lifetime guarantee. Process termination is confirmed only when destroy succeeds; command timeout or cancellation alone does not confirm termination. A terminated host may require explicit recovery cleanup.

Explicit destroy closes retained sessions in the same service instance. Cross-host recovery assumes the original owner is no longer running; there is no distributed fencing.

The trusted Docker HTTP executor remains execute-only, with shared identity and storage. It does not implement managed lifecycle or file APIs. No E2B, Daytona or Modal implementation is claimed. Cloudflare managed lifecycle is unverified live until an authorized, eligible isolated deployment runs the probe; local emulators are forbidden.

The private `src/adapters/probes/cloudflare-sandbox-probe.ts` exports `runCloudflareSandboxProbe(binding, namespace)`. An authorized deployed controller can run that Effect directly, without a public route. It starts UUID-owned resources, checks command/file behavior and cleanup after success, failure and interruption, then removes its observer containers. Do not invoke it until account eligibility and cost authorization are confirmed.

## Verification

Run installs and checks only in Docker, with one dependency installer at a time. Integration flags are `PLATFORM_INTEGRATION`, `PLATFORM_STORAGE_INTEGRATION`, and `PLATFORM_WORKFLOW_INTEGRATION`. Use a freshly migrated, uniquely named test database and a workflow host configured for that same database and an isolated task queue. Preserve existing databases.

Real-service tests cover PostgreSQL ownership, scoped Hyperdrive clients against PostgreSQL, migration replay, Redis leases/cache/pending recovery, S3 artifacts, SMTP acceptance, and Temporal completion/replay. Local compilation and PostgreSQL tests do not prove deployed Cloudflare behavior. Worker runtime validation requires an actual Cloudflare deployment; never use local Worker emulators or remote bindings.

`PLATFORM_SMTP_INTEGRATION=1` additionally requires authenticated test servers in `SMTP_STARTTLS_HOST` and `SMTP_TLS_HOST`, with their CA trusted through `NODE_EXTRA_CA_CERTS`. `PLATFORM_EXECUTOR_INTEGRATION=1` uses `EXECUTOR_URL` and `EXECUTOR_TOKEN` for a trusted Docker executor. The local scope test proves Effect cleanup/deadline handling against real filesystem operations, not Cloudflare lifecycle.
