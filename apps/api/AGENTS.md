# API

- Route folders mirror URL paths; keep each HTTP operation in its method file and register its Zod/OpenAPI contract.
- Session identity comes from Better Auth; never accept caller-supplied ownership or restore bearer-token shortcuts.
- Node pools live for the server scope; Cloudflare database clients live for one request. Propagate request cancellation.
- Email capture is private and preview-only. Local delivery uses Docker SMTP.
- Regenerate the frontend client after API contract changes.
