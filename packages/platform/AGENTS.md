# Platform

- Keep Cloudflare types inside adapters; domain capabilities require equivalent portable implementations.
- Scope Hyperdrive clients to each request or workflow step, and release every acquired client.
- Generate PostgreSQL migrations with Drizzle. Preview provisioning must apply them to an empty isolated branch.
- Treat private email capture objects as credentials; never serve them through public object routes.
