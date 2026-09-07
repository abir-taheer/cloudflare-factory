# Effect v4 and lint conventions

Verified 2026-09-07 against official documentation, published package metadata,
release declarations. This document
recommends patterns; it does not claim the current application implements every
recommendation.

## Versions and dependencies

| Package | Verified version | Use |
| --- | --- | --- |
| `effect` | `4.0.0-rc.112` | Shared runtime, services, Schema, HTTP |
| `@effect/platform-node` | `4.0.0-rc.112` | Node entrypoints only |
| `@effect/vitest` | `4.0.0-rc.112` | Optional Effect-aware Vitest tests |
| `typescript` | `7.0.2` | Compiler and type-aware lint compatibility |
| `oxlint` | `1.81.0` | Configured linter |
| `oxlint-tsgolint` | `7.0.2001` | Type-aware lint engine |
| `@effect/tsgo` | `0.41.0` | Optional Effect-specific diagnostics, not required by this config |

Effect v4 is still a release candidate. npm's `latest` Effect release is
`3.22.1`; use the exact v4 pin, not an unqualified install. Keep Effect runtime
and integration packages on matching RC versions. Tooling packages have their
own version numbers. HTTP and HTTP API modules remain under `effect/unstable/*`
and can have breaking changes in minor releases.

Sources: [v4 installation](https://effect.website/docs/v4/getting-started/installation),
[RC.112 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.112),
[package consolidation](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md),
[verified tooling compatibility](https://github.com/Effect-TS/tsgo#supported-package-versions).
Exact current tooling tags were also read directly from the public npm registry.

Older `/docs/code-style/*` links redirect to v3. Start with the explicitly
[versioned v4 reference](https://effect.website/docs/v4/api). The former
`effect-smol` repository is archived; v4 now lives in `Effect-TS/effect`.

## Services and layers

Keep contracts and use cases in `packages/platform/src`; runtime implementations
belong in `packages/platform/src/adapters`. Domain contracts must not mention
Cloudflare bindings, Node clients, HTTP request contexts, or provider SDK types.

Both v4 service forms are valid. The existing repository uses function syntax:

```ts
import { Context, Effect } from "effect";

interface NoteReaderService {
  readonly read: (id: string) => Effect.Effect<string, NoteMissing>;
}

const NoteReader = Context.Service<NoteReaderService>("@factory/platform/NoteReader");
```

Here `NoteMissing` is the tagged error defined below. Class syntax is also
`class NoteReader extends Context.Service<NoteReader, NoteReaderService>()("@factory/platform/NoteReader") {}`.
Do not reintroduce v3 `Context.Tag`, `Effect.Service`, `.Default`, generated
accessors, or the old `dependencies` option. Use explicit, unique service keys.
Read a service using `const reader = yield* NoteReader` inside `Effect.gen` or
`Effect.fn("NoteReader.read")(function* (...) { ... })`.

Sources: [service migration and exact signatures](https://github.com/Effect-TS/effect/blob/main/migration/services.md),
[v4 generators](https://effect.website/docs/v4/getting-started/using-generators).

| Need | Pattern |
| --- | --- |
| Supply an existing implementation | `Layer.succeed(Service, Service.of(implementation))` |
| Build a service from dependencies | `Layer.effect(Service, Effect.gen(...))`; capture dependencies during construction |
| Acquire and close a client | `Effect.acquireRelease(acquire, release)` inside `Layer.effect`; v4 removes its `Scope` requirement automatically |
| Dynamically construct multiple layers | `Layer.unwrap(effectReturningLayer)` |
| Wire a dependency | `ConsumerLayer.pipe(Layer.provide(DependencyLayer))` |
| Wire and retain the dependency in output | `ConsumerLayer.pipe(Layer.provideMerge(DependencyLayer))` |
| Combine independent providers | `Layer.mergeAll(...)`; this does not wire dependencies between siblings |
| Isolate a test's resources | `Layer.fresh(layer)` or `Effect.provide(layer, { local: true })` |

Build the application graph once at the Node entrypoint. A request should not
create a new PostgreSQL pool, Redis connection, SMTP transport, or Temporal
connection. Keep implementation dependencies out of public method requirements.
Use `layer` or descriptive variants for new exports; existing descriptively
named `*Layer` factories remain valid.

Sources: [release-tagged Layer implementation](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Layer.ts),
[v4 memoization](https://github.com/Effect-TS/effect/blob/main/migration/layer-memoization.md).
Memoization is not a process-global singleton guarantee across independent runs.

## Errors, external calls, and lifecycle

Use `Data.TaggedError("CapabilityError")<Fields>` for internal failures and
`Schema.TaggedError<Self>()(tag, fields)` for errors that need a schema:

```ts
import { Schema } from "effect";

export class NoteMissing extends Schema.TaggedError<NoteMissing>()("NoteMissing", {
  id: Schema.String,
}) {}
```

`Schema.TaggedErrorClass` is an older beta spelling, absent in RC.112. Construct
expected errors with `new NoteMissing({ id })`; return them with `Effect.fail`
or yield them inside a generator. Decode untrusted input with
`Schema.decodeUnknownEffect(schema)(input)`. Avoid assertions and duplicate
handwritten payload types; derive types from schemas.

Use `Effect.try` for throwing synchronous operations and
`Effect.tryPromise({ try: signal => sdkCall(signal), catch: cause => new CapabilityError(...) })`
at SDK boundaries. Forward the cancellation signal when supported. An `unknown`
cause field is appropriate; `Effect<A, unknown, R>` erases useful error contracts.
`Effect.promise` is for promises whose rejection is a defect, not routine I/O
failure. Prefer typed failure mapping over throws inside business logic.

Recover selectively with `Effect.catchTag`/`catchTags`; v4's general handlers
are `Effect.catch` and `Effect.catchCause`. Use `Effect.result` and `Result`
instead of v3 `Effect.either`/`Either`. A broad cause handler also sees defects
and interruption: do not turn cancellation or programmer errors into successful
responses. Log sanitized diagnostics; never serialize raw SDK causes or secrets
into public errors. Retry only retryable, safe/idempotent operations, with an
explicit bounded schedule and timeout.

Sources: [RC.112 Schema reference](https://effect.website/docs/v4/api/effect/Schema),
[creating effects](https://effect.website/docs/v4/getting-started/creating-effects),
[error renames](https://github.com/Effect-TS/effect/blob/main/migration/error-handling.md),
[API migration map](https://github.com/Effect-TS/effect/blob/main/migration/v3-to-v4.md).

Run Effects only at application/test boundaries. Use `NodeRuntime.runMain` and
`Layer.launch` for Node server ownership and shutdown. If integrating with a
Promise framework, one `ManagedRuntime.make(applicationLayer)` can own Node
services; call `dispose()` during shutdown. Prefer `Effect.forkChild` or
`Effect.forkScoped` for owned work, not detached fibers.

Workers have a different lifecycle. Bindings and request execution context must
not leak into an isolate-global service instance. Await work required for the
response; register permitted post-response work through `ctx.waitUntil` at the
Worker boundary. It is bounded background execution, not durable delivery; use
queues/workflows for durable work. Dispose request-owned resources only after
their consumers finish. A streaming response is not finished when its headers
are returned: preserve resources until EOF, cancellation, or failure.

Sources: [runtime migration](https://github.com/Effect-TS/effect/blob/main/migration/runtime.md),
[fork ownership](https://github.com/Effect-TS/effect/blob/main/migration/forking.md),
[Cloudflare execution context](https://developers.cloudflare.com/workers/runtime-apis/context/).

## HTTP patterns

Use `effect/unstable/http` for `HttpRouter`, `HttpServer`, `HttpEffect`, and
`FetchHttpClient`; use `effect/unstable/httpapi` for schema-defined APIs. The
existing shared `Request -> Effect<Response, E, R>` handler is a valid boundary;
adopting v4 does not require replacing it with another framework.

For new typed endpoints, use these RC.112 APIs:

```ts
const readNoteEndpoint = HttpApiEndpoint.get("read", "/notes/:id", {
  params: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ text: Schema.String }),
  error: NoteMissing.pipe(HttpApiSchema.status(404)),
});
const noteApi = HttpApi.make("NoteApi").add(
  HttpApiGroup.make("notes").add(readNoteEndpoint),
);
```

This fragment uses the imported HTTP API modules and `NoteMissing` above.
Implement with `HttpApiBuilder.group(api, "notes", handlers => ...)`, returning
`handlers.handle("read", ...)`; capture application services during group
construction. Register using `HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer))`.
Map internal provider errors to explicit public error schemas. Do not expose
the internal `CapabilityError.cause` as a response schema.

Serve Node via `HttpRouter.serve(apiLayer)`, provide
`NodeHttpServer.layer(createServer, { host, port })`, then run
`NodeRuntime.runMain(Layer.launch(serverLayer))`. For Workers,
`HttpRouter.toWebHandler(routerLayer)` returns `{ handler, dispose }`; remaining
request services can be supplied through `handler(request, context)`.

RC.112 `HttpApiBuilder.layer` also requires `FileSystem`, `Path`, `HttpPlatform`,
and `Etag.Generator`. Node's server layer supplies these. For a JSON-only Worker,
`HttpServer.layerServices` can satisfy them but includes a **no-op filesystem**
and is documented as a testing layer. It is not a file-serving/upload adapter.
Prefer plain `HttpRouter` for minimal Worker routes, or explicitly validate the
JSON-only composition; supply real platform capabilities when file operations
are needed. Never cast away these requirements.

For outbound HTTP, capture `HttpClient.HttpClient` and provide
`FetchHttpClient.layer` at the composition boundary. Decode responses with a
schema, handle non-success statuses deliberately, and consume/release response
bodies. Use native fetch only inside a deliberate runtime adapter.

Sources: [release HTTP API guide](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/HTTPAPI.md),
[HttpRouter reference](https://effect.website/docs/v4/api/effect/unstable/http/HttpRouter),
[HttpApiBuilder requirements](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts),
[FetchHttpClient](https://effect.website/docs/v4/api/effect/unstable/http/FetchHttpClient).

## Portable development

Use the actual entrypoints `apps/*/src/node-*.ts` and
`apps/*/src/cloudflare-*.ts`, and provider adapters under
`packages/platform/src/adapters`. Keep filenames kebab-case.

Local execution and verification run through Docker Compose. The portable
implementations use PostgreSQL, Redis, S3-compatible storage, SMTP, and Temporal
according to their service contracts. Cloudflare implementations use bindings.
Do not make local development depend on Wrangler dev, Miniflare, remote
bindings, or production credentials. A Workers compatibility flag does not make
every Node package portable; some supported Node APIs are partial or stubs.
[Cloudflare Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

Define observable guarantees per capability: queue acceptance versus processing,
duplicate delivery, cache TTL, lease ownership, and email acceptance versus
delivery. Local Redis leases do not acquire Durable Object semantics by sharing
an interface. Keep sandbox execution explicitly unavailable until a real isolated
executor exists. Exercise the same capability contracts against both adapters;
test HTTP status/body, persistent state, cancellation, and resource release.
Avoid tests of private helper calls or snapshots of implementation structure.

## Standard Oxlint configuration

The checked-in `.oxlintrc.json` uses **standard Oxlint 1.81.0** and its shipped
schema. It has no `@effect/tsgo` dependency or custom plugin import. All seven
categories start at error: correctness, suspicious, pedantic, perf, style,
restriction, and nursery. Enabled plugins are TypeScript, Unicorn, Oxc, import,
and Promise. Framework-specific plugins are not enabled for unrelated frameworks.

Type-aware lint and compiler diagnostics are enabled, warnings fail, the warning
budget is zero, and unused suppressions fail. Keep every source file included in
a real tsconfig, with dependencies resolved before lint. `typeCheck` is currently
an experimental Oxlint feature, so the installed compiler remains useful for
cross-checking diagnostics. Do not run with `--quiet` to hide warnings.

Run the real repository command:

```sh
docker compose run --rm tools npm run lint
```

Sources: [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html),
[type-aware linting and monorepos](https://oxc.rs/docs/guide/usage/linter/type-aware.html),
[configuration options](https://oxc.rs/docs/guide/usage/linter/config-file-reference.html).

### Documented exceptions

These are design choices, not permission to disable a category when it reports
an error. Unlisted enabled rules remain enforced.

| Rule(s) | Reason or replacement |
| --- | --- |
| `func-names`, `func-style` | Allow generator callbacks, declarations, and `Effect.fn` factories; tracing names carry operation identity. |
| `id-length`, `no-magic-numbers` | HTTP statuses, schema bounds, indices, and protocol fields are legitimate literals; name meaningful policy constants in review. |
| `curly: multi-line` | Allow existing one-line guards; multiline bodies require braces. |
| `one-var: never` | One declaration per statement rather than combined declarations. |
| `no-ternary`, `unicorn/prefer-ternary` | Neither forbid nor force simple ternaries; nested ternaries remain errors. |
| `no-undefined`, `unicorn/no-null`, `no-underscore-dangle` | Optional values, provider null results, and Effect `_tag` are legitimate contracts. |
| `new-cap: capIsNew=false`, `unicorn/throw-new-error` | Capitalized Schema/Context factories are not constructors; Unicorn falsely flags `Schema.TaggedError` as a missing `new`. |
| `sort-imports`, `sort-keys`, `import/exports-last`, `import/group-exports` | Preserve dependency/readability order and colocate exports. |
| `import/no-named-export`, `import/prefer-default-export` | Named exports are the shared-code convention; default exports remain restricted. |
| `import/no-namespace` | Effect namespace imports are supported. |
| `import/no-relative-parent-imports` | Relative imports inside a package are normal; workspace dependencies should use package exports. |
| `no-duplicate-imports` | `import/no-duplicates` owns duplicate checking with type/value import support. |
| `import/consistent-type-specifier-style` | Allow standalone type-only imports and inline specifiers together; `typescript/consistent-type-imports` still requires type-only use to be marked. |
| `oxc/no-optional-chaining`, `oxc/no-rest-spread-properties` | These conflict with optional-chain and immutable-object preferences. |
| `typescript/explicit-function-return-type`, `typescript/explicit-module-boundary-types` | Preserve Effect inference; service interfaces still declare success/error contracts. |
| `typescript/no-extraneous-class`, `unicorn/no-static-only-class`, `max-classes-per-file` | Effect service/error classes are valid, including colocated capability contracts. |
| `typescript/non-nullable-type-assertion-style` | Conflicts with the assertion ban. |
| `typescript/prefer-readonly-parameter-types` | Does not distinguish mutable SDK handles from mutable domain contracts; retain readonly domain fields. |
| `typescript/promise-function-async`, `require-await`, `oxc/no-async-await` | Promise-returning adapters, `Effect.tryPromise` callbacks, and Temporal orchestration cannot satisfy competing blanket async rules. Typed promise checks stay on. |
| `typescript/parameter-properties`, explicit accessibility `no-public` | Allow concise SDK/DO constructors without mandatory redundant `public`. |
| `unicorn/consistent-function-scoping` | Service/layer construction intentionally captures dependencies and lifetime. |
| `unicorn/prefer-global-this` | Keep `Effect`, `Schema`, and Web API names recognizable without forced qualification. |
| `prefer-destructuring`, `capitalized-comments`, `no-inline-comments` | Avoid arbitrary rewrites of named intermediate values and concise explanations. |
| `no-plusplus: allowForLoopAfterthoughts=true` | Allow conventional counting loops; other increments remain restricted. |
| Complexity/size limits | Complexity 25, 50 statements, 150 nonblank/noncomment function lines, 6 parameters, 8 nested calls; avoid defaults that reject normal layer/SDK composition. |

Path-specific exceptions:

- TypeScript: disable syntax-only `no-undef`; `typeCheck` resolves identifiers and
  catches missing globals/types. Browser JS retains `no-undef` with browser globals.
- Node entrypoints, adapters, scripts, and `apps/api/src/portable-configuration.ts`:
  allow Node imports. Cloudflare entrypoints and `cloudflare*`, `d1-*`, `r2-*`
  adapter files re-enable the Node import ban and reject `@effect/platform-node`.
- Cloudflare entrypoints: allow the platform-required default handler export.
- `playwright.config.ts`: allow the runner-required default configuration export
  and Node configuration environment.
- Runtime bridges/adapters/scripts: permit async endpoint handlers. Adapter and
  Cloudflare binding interfaces may use methods; adapters may expose async SDK
  contracts with no local await (`typescript/require-await` exception).
- Adapter/preview loops and shared HTTP body readers: allow sequential awaits
  for pagination, ordered consumption, and bounded streaming.
- `packages/platform/src/index.ts` and adapter `portable.ts`: allow intentional
  package entrypoint re-exports instead of forbidding all barrels.
- `apps/frontend/public/**/*.js`: browser classic scripts, matching the current
  HTML; no forced ES-module export or module-only global restriction.
- Tests: allow Node imports, async fixtures with no await, and only `node:test`
  registration calls as known-safe promises; never globally ignore floating
  promises or `void` promises.
- Generated bindings and build/cache outputs are lint-ignored, not hand-written
  application source. TypeScript still consumes generated declarations.

### Effect-specific diagnostics

Standard Oxlint does not detect floating Effect values or secret data flow. Review
execution boundaries and credential handling explicitly. The optional official
Effect tooling requires a separately installed and patched `@effect/tsgo`; this
configuration never references absent plugin packages.

Source: [Effect devtools](https://effect.website/docs/v4/getting-started/devtools).

## Validation

Run `docker compose run --rm tools npm run check`. All seven lint categories are
enabled, with the compatibility exceptions listed above. Type errors, warnings,
unsafe assignments, floating promises, and unused suppression comments fail the
check. Docker blackbox tests exercise the real HTTP and provider boundaries.
