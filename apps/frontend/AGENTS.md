# Frontend

- React + Router + TanStack Query; MUI components and theme belong in small scoped modules.
- Node and Cloudflare serve assets only. Browser API calls use the generated client; Better Auth owns `/api/auth`.
- Only `API_URL` and `ENVIRONMENT` enter public runtime config. Never bundle backend settings or secrets.
- Run builds, HMR, checks and real cross-origin browser tests in Docker.
