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
- `SMTP_HOST`, numeric `SMTP_PORT`; optional `smtpSecure` and `smtpAuth`
- `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`
- `PLATFORM_NAMESPACE` and the registered `workflowType`

The platform namespace prefixes Redis keys. Endpoint and credential configuration has no production fallback. Email and sandbox capabilities are supplied explicitly on Cloudflare; the portable aggregate supplies SMTP, with the HTTP executor or unavailable sandbox layer added separately. Captured authentication emails are private objects and must never be exposed through public object routes.

## Job behavior

`runNoteJob({id,noteId,ownerUserId})` acquires a 60-second lease keyed by `id` with a fresh attempt token. Contention is a typed retryable failure; release checks ownership on success, failure, and interruption. Leases do not provide fencing or renewal.

The job validates cached notes at `note/${encodeURIComponent(ownerUserId)}/${noteId}`, falls back to an owner-scoped database read for missing or malformed content, and caches that immutable note for 300 seconds. It writes `{id,noteId,ownerUserId,status:"completed",content:note.text.toUpperCase()}` to `job/${id}.json`. Replays overwrite the same artifact; completion is returned only after storage succeeds.

Redis queue consumers use stream groups: `ensureRedisQueueGroup`, `consumeRedisJobs`, and `reclaimRedisJobs`. Acknowledgment follows successful downstream processing or durable acceptance; failures remain pending for recovery. Streams are not automatically trimmed. Temporal uses the job ID as workflow ID and accepts only its known already-started error as a duplicate. Workflow start confirms acceptance, not job completion.

Object reads buffer modest artifacts; missing objects return null. KV is eventually consistent, with a minimum 60-second cache TTL. SMTP and Cloudflare email acceptance do not guarantee delivery. Sandbox adapters call the real Cloudflare SDK or a separately isolated HTTP executor; command execution never runs inside the application host.

## Verification

Run installs and checks only in Docker, with one dependency installer at a time. Integration flags are `PLATFORM_INTEGRATION`, `PLATFORM_STORAGE_INTEGRATION`, and `PLATFORM_WORKFLOW_INTEGRATION`. Use a freshly migrated, uniquely named test database and a workflow host configured for that same database and an isolated task queue. Preserve existing databases.

Real-service tests cover PostgreSQL ownership, scoped Hyperdrive clients against PostgreSQL, migration replay, Redis leases/cache/pending recovery, S3 artifacts, SMTP acceptance, and Temporal completion/replay. Local compilation and PostgreSQL tests do not prove deployed Cloudflare behavior. Worker runtime validation requires an actual Cloudflare deployment; never use local Worker emulators or remote bindings.
