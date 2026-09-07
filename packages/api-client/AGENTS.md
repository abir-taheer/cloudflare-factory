# API client

- Generate from the shared OpenAPI contract in Docker; never edit generated files by hand.
- Keep HTTP normalization and credential handling in `src/http.ts`; public API origin has no fallback.
- Run `check:generated` to detect contract drift before publishing.

- Keyring reference: `scripts/build_client.mjs` generates OpenAPI types plus Orval Zod response schemas; `client/http_transport.ts` validates responses. After the lint freeze, compare Keyring’s generated `paths` plus openapi-fetch/openapi-react-query against Orval before choosing the client pipeline. Retain one API-derived `openapi.json`, runtime response validation, and generated-artifact drift checks. Do not copy Keyring bearer authentication; this app uses Better Auth sessions.
