# Authentication

- Keep sessions and verification in Better Auth; derive ownership from verified sessions only.
- Await the injected email provider. Never log verification links, passwords, cookies or provider causes.
- Generate schema changes with the pinned Better Auth CLI, then Drizzle migrations; never handwrite auth tables.
