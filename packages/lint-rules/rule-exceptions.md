# Explicit rule exceptions

All seven categories remain errors. These choices resolve contradictory styles or actual runtime/tool APIs; they are not baseline suppression. `.oxlintrc.json` is the authoritative exact scope list. Every other enabled-plugin catalog rule remains category-controlled. Thresholds are complexity 20, function length 100 meaningful lines, 50 statements, six parameters, eight nested calls and one class per file.

## Global disabled rules

| Rule                                         | Reason / enforced alternative                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| id-length                                    | Short conventional indices and Zod's canonical z are meaningful; domain naming/path checks remain.              |
| no-ternary                                   | Simple expressions allowed; nested and complex ternaries error.                                                 |
| no-undefined                                 | Explicit absence is necessary in JS/typed optional API contracts.                                               |
| no-underscore-dangle                         | Effect tagged/runtime fields use underscore conventions.                                                        |
| sort-keys                                    | Domain grouping and schema field order take precedence over alphabetical objects.                               |
| import/exports-last                          | Declaration-site named exports remain searchable.                                                               |
| import/group-exports                         | Same: export at declaration, not a detached export list.                                                        |
| import/no-named-export                       | Named exports are the chosen convention.                                                                        |
| import/no-namespace                          | Canonical Effect namespace and typed library APIs require namespace imports; contract names checked separately. |
| import/no-relative-parent-imports            | Internal module imports may cross sibling directories without inventing packages.                               |
| import/prefer-default-export                 | Conflicts with named exports.                                                                                   |
| oxc/no-optional-chaining                     | Optional chaining is the chosen safe access syntax.                                                             |
| oxc/no-rest-spread-properties                | Immutable object construction is allowed; unnecessary spreads are rejected.                                     |
| typescript/explicit-function-return-type     | Preserve inferred Effect/Zod types; type checking remains enabled.                                              |
| typescript/explicit-module-boundary-types    | Same schema/runtime inference policy, rather than handwritten duplicate shapes.                                 |
| typescript/no-extraneous-class               | Effect Context.Service and tagged error classes are framework contracts.                                        |
| typescript/non-nullable-type-assertion-style | Conflicts with prohibition on assertions; use real narrowing.                                                   |
| typescript/prefer-readonly-parameter-types   | Library capability types are not deeply readonly; native prefer-readonly remains enabled.                       |
| typescript/promise-function-async            | Returning an existing Promise is valid without another async wrapper.                                           |
| unicorn/consistent-function-scoping          | Local helper placement follows domain usage rather than forced hoisting.                                        |
| unicorn/no-null                              | Null is a real SQL/HTTP/library boundary value.                                                                 |
| unicorn/no-static-only-class                 | Effect service classes use static members.                                                                      |
| unicorn/prefer-global-this                   | Browser and Node boundary names remain explicit.                                                                |
| unicorn/prefer-ternary                       | Conflicts with readability preference for multiline control flow.                                               |
| unicorn/throw-new-error                      | Effect error factories return tagged failures rather than throwing constructors.                                |
| prefer-destructuring                         | Named property access preserves context and avoids unnecessary locals.                                          |
| import/consistent-type-specifier-style       | TypeScript consistent-type-imports owns inline type specifiers.                                                 |
| no-duplicate-imports                         | Import plugin's no-duplicates owns type-aware duplicate handling.                                               |
| oxc/no-async-await                           | Host/SDK Promise adapters legitimately use async/await.                                                         |
| require-await                                | Type-aware typescript/require-await owns this check.                                                            |
| typescript/parameter-properties              | Constructor properties are concise typed declarations.                                                          |
| no-inline-comments                           | Short explanations may remain beside relevant code.                                                             |
| capitalized-comments                         | Code fragments, identifiers and directives need not be capitalized; unjustified multiline comments still fail.  |
| promise/prefer-await-to-then                 | Replaced by factory equivalent preserving native semantics plus verified imported Effect calls.                 |
| promise/prefer-await-to-callbacks            | Replaced by factory equivalent; direct imported node:util promisify is a legitimate Promise adapter.            |
| node/no-sync                                 | Replaced by import-provenance factory/no-sync-node-io; suffix-only matching falsely flags pure Effect.runSync.  |
| react/react-in-jsx-scope                     | React automatic JSX does not require importing React.                                                           |
| react/jsx-no-literals                        | Product copy does not imply a user-requested internationalization framework.                                    |
| jsdoc/require-param                          | Typed declarations plus concise export documentation avoid redundant prose.                                     |
| jsdoc/require-returns                        | Same concise-documentation policy.                                                                              |
| jsdoc/require-yields                         | Same for typed Effect generators.                                                                               |
| jsdoc/require-param-type                     | TypeScript owns parameter types.                                                                                |
| jsdoc/require-property-type                  | TypeScript owns property types.                                                                                 |
| jsdoc/require-returns-type                   | TypeScript owns return types.                                                                                   |
| jsdoc/require-yields-type                    | TypeScript owns generator types.                                                                                |

## Scoped exceptions

| Disabled rule / scope                                                                                                                    | Reason                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| no-undef in TS/TSX                                                                                                                       | TypeScript resolves names, namespaces and type declarations.                                                                                       |
| import/no-nodejs-modules in Node hosts, scripts, portable adapters, tests and lint tooling                                               | These are Node execution environments; domain and Worker restrictions remain.                                                                      |
| Runtime no-restricted-imports overrides                                                                                                  | Node hosts/adapters admit platform-node; Cloudflare hosts/adapters admit Cloudflare bindings. Every override preserves the Effect Schema/flow ban. |
| Default export prohibitions in Worker entrypoints                                                                                        | Worker module ABI requires a default handler.                                                                                                      |
| import/no-default-export and import/no-anonymous-default-export in playwright.config.ts                                                  | Tool configuration API requires a default export.                                                                                                  |
| import/no-default-export in factory-lint-plugin.mjs and ESLint config files                                                              | Plugin/config loader API requires default exports.                                                                                                 |
| oxc/no-async-endpoint-handlers in hosts, adapters and scripts                                                                            | These are SDK/host bridges, not API route declarations.                                                                                            |
| typescript/require-await in tests and adapters                                                                                           | Promise-shaped SDK contracts and test callbacks can return synchronously.                                                                          |
| typescript/method-signature-style in adapters/Worker hosts                                                                               | Implemented provider interface signatures follow the external API.                                                                                 |
| no-magic-numbers in tests                                                                                                                | Fixture values and status expectations are intentional test inputs; source retains named constants.                                                |
| node/no-process-env in tests                                                                                                             | Tests assemble isolated environments explicitly.                                                                                                   |
| no-await-in-loop in adapters, scripts and api-handler.ts                                                                                 | Sequential migrations, cleanup and streaming must retain ordering/backpressure.                                                                    |
| oxc/no-barrel-file and unicorn/prefer-export-from in platform index.ts and adapters/portable.ts                                          | These two files define the package's supported public adapter surface.                                                                             |
| factory/no-effect-run in host entrypoints, CLI entrypoints and tests                                                                     | Execute the Effect only at lifecycle boundaries.                                                                                                   |
| factory/no-effect-run in http/run-route-effect.ts                                                                                        | Shared HTTP Effect-to-Promise bridge.                                                                                                              |
| factory/no-effect-run in api-configuration.ts                                                                                            | Explicit synchronous validated startup configuration.                                                                                              |
| factory/no-effect-run in migrate-postgres.ts                                                                                             | Migration executable.                                                                                                                              |
| factory/no-effect-run in authentication-email.ts                                                                                         | BetterAuth provider's Promise callback bridge; no auth-domain exemption.                                                                           |
| factory/no-reannotated-auth-context in http/run-route-effect.ts                                                                          | Single canonical auth-context bridge, not route handler reannotation.                                                                              |
| typescript/no-unsafe-assignment, no-unsafe-member-access, no-unsafe-call, no-unsafe-return, no-unsafe-argument in lint mjs               | Copied ESLint/Oxlint AST callbacks expose untyped JS values; application TS remains fully checked.                                                 |
| typescript/strict-boolean-expressions, strict-void-return, no-misused-promises, consistent-return, prefer-nullish-coalescing in lint mjs | Same untyped AST/tool callback constraint; syntax rules and behavioral tests still run.                                                            |
| no-continue in lint mjs                                                                                                                  | AST traversals use guard/continue rather than nested visitor blocks.                                                                               |
| no-template-curly-in-string in rule tests                                                                                                | Fixture strings intentionally contain template syntax to parse.                                                                                    |
| node/no-top-level-await in Node/CLI entrypoints, build-worker.ts, migrate-postgres.ts and path-conventions.mjs                           | ESM executable startup is an intentional async boundary.                                                                                           |
| factory/no-sync-node-io in lint tests and path-conventions.mjs                                                                           | Short-lived fixture and filesystem audit executables, never request-serving code.                                                                  |
| node/no-process-env in exact configuration/controller files listed in config                                                             | Validated environment input, credential-provider access or deliberate subprocess environment forwarding. No blanket script/domain exemption.       |

The exact environment boundaries currently cover executor configuration, preview configuration/options/context/build/command, Playwright configuration, preview Doppler/Cloudflare/Neon/GitHub clients and CLI migration/deploy commands, and production-artifacts-cli.ts. Remove entries when their implementation moves or is deleted. Deleted pg-client declarations, old frontend HTTP/configuration files and removed database adapters have no exemptions.

The node:test floating-Promise override permits only known node:test registration calls. It retains checkThenables, ignoreVoid:false and ignoreIIFE:false. React component props reject untyped inline style but permit MUI sx and className; no Tailwind-specific policy or formatter exists.

## Generated API declaration

Only `packages/api-client/src/api-paths.d.ts` disables `max-lines`, `no-magic-numbers`, `typescript/consistent-indexed-object-style` and `factory/require-blank-lines-between-statement-types`. These reflect openapi-typescript's declaration layout and HTTP status keys. No folder, authored module, type-checking or security exemption is added. Keyring ignores exact generated client artifacts; this repository keeps all other checks on this declaration. A configured CLI regression proves neighboring authored declarations remain strict and the Effect Schema prohibition still applies to the generated path.

Every root lint runs `npm run check:generated --workspace @factory/api-client`; root check includes that same lint gate. The generator formats declarations with Prettier before comparing both the declaration and `openapi.json` against fresh output. Prettier still checks both committed artifacts; hand edits and contract drift must fail generation verification.
