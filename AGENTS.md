# Working agreements
- Run development, dependency installation and verification in Docker (`docker compose run --rm tools …`). Never use Wrangler dev, Miniflare or remote bindings locally.
- Backend and infrastructure code uses Effect v4. Verify APIs against the pinned package and official v4 docs; v3 examples are incompatible.
- Domain services must not import Cloudflare types. Bindings belong in provider adapters; retain a working portable adapter for each capability.
- Preview resources and credentials must be independent of production. Fail closed on missing ownership or configuration; never infer production fallbacks.
- Deploy credentials come from Doppler through named GitHub environments. Never commit rendered deployment configuration, tokens, account identifiers or local state.
- Run `npm run check` and blackbox tests before pushing. Keep this file concise; document commands and architecture elsewhere.
