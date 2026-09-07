# Frontend

React, Vite, Router, TanStack Query and MUI. Feature work is paused for the strict lint baseline; only the recovery view is currently registered.

Current browser coverage is unavailable: `tests/blackbox.spec.ts` still targets the removed bearer-auth implementation. Its earlier Docker results do not validate this frontend. After the lint freeze, replace it with real cross-origin signup, Mailpit email verification, signin, note/job completion, and signout/denial tests.

- Cloudflare entry: `src/cloudflare-frontend.ts`, ASSETS only with `assets.run_worker_first = true`.
- Node entry: `src/node-frontend.ts`, serves `dist`; typed `ENVIRONMENT` and `PORT` are required.
- Public `dist/runtime-config.json` contains only `API_URL` and `ENVIRONMENT` (`dev`, `preview`, `prod`). API calls go directly to that origin.
- Docker HMR uses `src/node-vite.ts` with typed `VITE_API_URL`, `ENVIRONMENT=dev` and `PORT`.

Run `npm run check --workspace @factory/frontend` and `npm run build --workspace @factory/frontend` through `docker compose run --rm tools`.

React Doctor scans the full project with every category and applicable optional rule at error severity, empty ignore lists, and inline suppressions disabled. Optional classic-JSX/class-component rules, the blanket component-prop ban (MUI accepts styling props), and checks for absent Ink, Tailwind, styled-components and Three.js integrations remain disabled; TypeScript JSX conventions are enforced by root lint. React Doctor does not replace root Oxlint or the official React compiler lint rules. Score, telemetry and Socket checks are disabled; dependency auditing remains separate. The mandatory `lint:react-doctor` command validates the stock JSON report with Zod and requires a complete single-project scan, equal positive scanned/analyzed counts, no skips and no findings. It uses a failing process timeout, not `--max-duration`. Verification: stock 0.9.13 returned exit 0 with 0/18 files and `complete:false` under a 1 ms budget; the gate rejected that captured report and accepted the complete 18/18 report. `lint:react-hooks` separately runs the official recommended-latest compiler preset with every severity promoted to error.

Hooks audit (7.1.1): 17 recommended-latest rules plus seven applicable optional rules run as errors. Internal `invariant`/`todo`, unused FBT integration, removed `component-hook-factories`, and blanket `memoized-effect-dependencies` are omitted; the latter demands manual memoization beyond React’s dependency correctness checks. React Doctor uses `--no-cache`; its empty inline-audit backup parent is removed with `rmdir`, while any retained backup fails the gate and is preserved for inspection.
