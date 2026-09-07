# API client

- `npm run generate --workspace @factory/api-client` regenerates `openapi.json` and `src/api-paths.d.ts` from Hono routes. Never edit either artifact by hand.
- Keep HTTP normalization and credential handling in `src/http.ts`; public API origin has no fallback.
- `check:generated` validates public OpenAPI shape, rejects deployment server URLs, and detects drift. Client base URL always comes from validated runtime configuration.

- `openapi-typescript` generates `paths`; openapi-fetch and openapi-react-query handle typed session requests. Shared Zod schemas validate responses.
