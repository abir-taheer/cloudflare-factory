# Working agreements

- Before writing code, read [How coding agents read your code](https://modem.dev/blog/how-coding-agents-read-your-code). Use searchable domain names and one spelling per concept.
- Use kebab-case for authored files and folders; preserve tool-required names. Keep modules focused, remove abandoned paths, and check the surrounding folder structure when adding or moving code.
- Run development, dependency installation and verification in Docker (`docker compose run --rm tools …`). Never use Wrangler dev, Miniflare or remote bindings locally.
- Backend and infrastructure code uses Effect v4. Verify APIs against the pinned package and official v4 docs; v3 examples are incompatible.
- Define input contracts with Zod 4.5 and infer types. Reuse schema `.pick()`/`.omit()`/`.extend()` and type `Pick`/`Omit`; do not duplicate shapes. Effect Schema is forbidden; Effect handles runtime orchestration and errors.
- Domain services must not import Cloudflare types. Bindings belong in provider adapters; retain a working portable adapter for each capability.
- Preview resources and credentials must be independent of production. Fail closed on missing ownership or configuration; never infer production fallbacks.
- Use only dev, preview and prod. Runtime configuration is typed; each app has its own Doppler project, with CI credentials in a separate project.
- Use environment-neutral variable names. Doppler projects/configs separate app and CI scope. Keep resource names/IDs in configuration or private state; never commit rendered Wrangler config or credentials.
- When replacing an implementation, remove its abandoned code, dependencies, configuration, tests and documentation in the same change.
- Establish a passing strict lint baseline before adding features; never defer lint cleanup or weaken rules to accommodate new code.
- Prefer small, established implementations over custom infrastructure or unnecessarily heavy dependencies.
- At every checkpoint, request an independent agent review using Glen's `abir-pr-review` skill before committing.
- Run `npm run check` and blackbox tests before pushing. Keep this file concise; document commands and architecture elsewhere.
