# Provider boundaries

Domain programs depend on Effect services. Composition roots supply Layers; replacing a provider does not require changing the note/job program.

| Capability   | Cloudflare               | Portable implementation | Contract limit                                                                                               |
| ------------ | ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Database     | Hyperdrive → PostgreSQL  | PostgreSQL              | Shared Drizzle schema and generated migrations; deployment provisions an isolated database before Hyperdrive |
| Objects      | R2 binding               | S3-compatible API       | Binary put/get/delete; missing objects return null                                                           |
| Cache        | KV binding               | Redis                   | Optional TTL; KV is eventually consistent                                                                    |
| Queue        | Queues binding           | Redis Streams           | At-least-once delivery; acknowledge only accepted jobs, reclaim pending messages                             |
| Workflows    | Workflows                | Temporal                | Deterministic orchestration; replay-safe Effect activities                                                   |
| Coordination | SQLite Durable Objects   | Redis leases            | Expiring ownership tokens; leases are not fencing locks                                                      |
| Email        | Cloudflare email binding | SMTP                    | Provider acceptance, not delivery; previews do not send external email by default                            |
| Sandbox      | Sandbox SDK handle       | Isolated HTTP executor  | Bounded output and timeout; explicit opt-in                                                                  |

Local services have Compose-scoped volumes. Infrastructure ports are internal, with only frontend, API and Mailpit bound to loopback. Change the Compose project name and host ports when running multiple independent local checkouts.

The local executor runs as an unprivileged user with a read-only filesystem, limited CPU/memory/process count and a small temporary filesystem. Its network is internal and separate from databases, storage and mail. It has no host mounts or Docker socket. It is intended for one trusted development session; separate containers are required for mutually untrusted tenants. Do not publish its endpoint.

Cloudflare Sandbox requires a paid plan and is disabled by default. Hyperdrive is a connection proxy, not a database: each preview must obtain an independent empty PostgreSQL database and scoped credentials from the configured provisioning adapter. Neither capability may fall back to a shared production resource.

Self-hosted production needs independently operated PostgreSQL, Redis, S3-compatible storage, SMTP and Temporal with TLS, access control, backups and retention configured by the operator. Compose supplies local development infrastructure, not a production cluster.
