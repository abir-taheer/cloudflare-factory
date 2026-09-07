# Workflows

- Queue deliveries can repeat. Preserve job IDs and owner identity across retries; make activities idempotent.
- Keep orchestration deterministic and step results small. Never return credentials or document contents into workflow history.
- Exercise the portable Temporal implementation in Docker; Cloudflare code is a deployment adapter.
