# API contract

- Zod schemas are the shared source for API validation and OpenAPI generation.
- Keep schemas independent of runtime bindings, credentials and browser state.
- Regenerate the API client and verify its drift check after contract changes.
