# Agent workflow

This is a bootstrapped product template. Agents should take product requirements
through implementation, isolated verification, review and merge. Authentication,
frontend theming, typed APIs, database access and background jobs are starting
capabilities to build on. The notes example demonstrates one complete feature;
extend or replace it with the product's domain.

[AGENTS.md](../AGENTS.md) sets the rules; app and package guides add local constraints.
Start navigation from the [README layout](../README.md#layout).

## Start a change

1. Read the request, relevant guides and existing implementation. State the user-visible
   outcome and how you will prove it before adding abstractions.
2. Inspect `git status`, the default branch and current PR head. Preserve other work.
   Give each agent task its own feature branch/worktree and isolated local Compose
   project/ports. Do not rename the default branch: use the product's `main`, `master`
   or other configured name.
3. Trace the entire affected path: frontend → contract/client → API route → domain
   capability → provider. Follow existing folder boundaries and remove replaced code.
4. Use synthetic data in Docker or the PR's isolated resources. Keep live identifiers,
   credentials, generated deployment files and investigation receipts in ignored private
   storage. Never copy production data into a preview.

Keep Zod contracts authoritative. After changing an API contract, regenerate rather
than hand-editing the client:

```sh
docker compose run --rm --no-deps tools npm run generate --workspace @factory/api-client
```

Choose provider Layers at the composition root; keep both Cloudflare and portable
paths working. Check [Effect v4 guidance](./effect_v4.md) before changing backend
or infrastructure code and [provider contracts](./providers.md) before adding a capability.

## Verify locally before pushing

Start with the strict baseline, then run it again after the change:

```sh
docker compose up --build --wait
docker compose run --rm --no-deps --build tools npm run check
```

`check` includes formatting, generated-client drift, folder conventions, lint/type
checks, React checks and unit tests. Some real-service tests are opt-in; a local
pass with skipped tests is not evidence that those integrations ran.

Use the [runtime-image blackbox procedure](./docker.md#runtime-images) before pushing.
It exercises compiled apps and real Docker services, including email verification,
sessions, notes, completed workflows and password reset. Use Mailpit for local email.
Coordinate host ports with other work; only remove volumes owned by your disposable
test project. See [validation.yml](../.github/workflows/validation.yml) for CI's exact
integration flags and commands.

Add focused tests for the changed behavior and relevant denial/failure paths.
Prefer real HTTP, database and provider outcomes over mocks or assertions about
implementation shape. A healthy homepage alone does not prove a feature works.
Request an independent Glen `abir-pr-review` checkpoint review, address its findings,
then commit and push. Never weaken checks to make a new implementation pass.

## Follow the PR preview

Opening, pushing to or reopening an internal PR starts **Preview build**. It validates
the change and uploads credential-free Worker modules and frontend assets. Fork PRs
do not receive deployable artifacts or privileged previews.

Successful builds trigger **Preview deploy** from the trusted default branch using
the named `cloudflare-preview` GitHub environment. The controller verifies the source
build and current PR head before provisioning and deploying. Its own commit is not
the PR commit: correlate the triggering build run and PR head, not just the deploy
run's `headSha`. App bundles and generated SQL migrations come from the PR revision;
the migration runner and deployment controller remain trusted default-branch code.
Controller changes themselves need local verification and a reviewed default-branch
update before a fresh smoke PR can exercise them.

Each PR gets an empty PostgreSQL branch and isolated Hyperdrive, storage, queue,
Workers, Workflow and Durable Object resources. API and frontend have separate
custom subdomains; workflows stay private. Pushes reuse that PR's data until cleanup.
Database provisioning is swappable through the [composite action contract](./preview_environments.md#database-composite-actions).

Wait for the PR-head **Preview verified** status, not just validation/build. Its link
opens the deployment run; the summary provides the frontend/API URLs and revision.
Lifecycle runs queue behind each other. Do not guess or commit live URLs. Match the
deployed PR head to the latest push before reporting success.
The deploy verifier exercises real signup, captured email verification, login,
note persistence, a completed workflow and Chromium UI/sign-out behavior.

For additional tests, use the [authorized local preview procedure](./preview_environments.md#authorized-local-docker-smoke)
and its `verify --local --pr` command inside Docker. Verification writes synthetic
users, notes and jobs. Preview email stays in its private object store; never expose
an inbox route, log verification links or substitute a bearer-token shortcut.
Inspect changed UI in a browser and test the feature's actual success and failure
paths beyond the baseline verifier. Test opt-in capabilities such as Sandbox explicitly.

## Finish and report evidence

- Finish the requested feature, including UI, API, persistence and background behavior
  where needed. Tests support shipping the feature; passing the starter demo alone
  is not completion. Keep commits reviewable without artificially limiting feature scope.
- Address review findings and current-head checks, then merge when authorized. Require
  **Preview verified** in default-branch protection. Refresh an out-of-date branch and
  verify its new head before merging; never merge a failed preview because build is green.
- Record the commit, PR and relevant build/deploy run IDs, tests actually run, skipped
  coverage, review findings and observed feature behavior. Separate local success,
  current-head CI, live preview verification and merge status.
- If a run fails, inspect that run's failing step before retrying. Fix code/configuration
  at its source; never bypass ownership checks or manually delete foreign resources.
- Closing a PR triggers cleanup; reconciliation also handles expired or interrupted
  previews. For lifecycle changes, prove teardown on a disposable smoke PR, including
  Cloudflare resources and the database branch. Keep the active review preview available.
- After bootstrap, enable [deployment on merge](./production.md) for the product.
  Default-branch pushes then validate and release the merged revision through the
  protected production environment. Manual per-app deployment remains available.
  Preview credentials/data never become production credentials/data.

Use [preview operations](./preview_environments.md) for credentials, identity pins,
domain ownership, recovery and cleanup details. Keep this guide about agent behavior;
do not duplicate provider setup or store current deployment state here.
