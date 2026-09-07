import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewString } from "../preview_model.ts";
import { loadPreviewContext } from "../preview_context.ts";
import { loadNeonDatabaseCredentials } from "../../shared/database/neon_api.ts";
import {
  createNeonDatabaseAdapter,
  createNeonDatabaseIdentity,
} from "../../shared/database/neon_adapter.ts";
import { cleanupPreviewDatabase, provisionPreviewDatabase } from "./preview_database_lifecycle.ts";
import { writeDatabaseHandoff } from "../../shared/database/database_contract.ts";
import { readPreviewPullRequest, resolvePreviewRun } from "../github/preview_github.ts";

const cliArgumentOffset = 2;

/** This provider runner is selected only by trusted composite actions or explicit local Docker invocation. */
export const runNeonPreviewAction = (args: string[]) =>
  Effect.gen(function* () {
    const mode = args[0];

    if (
      (mode !== "provision" && mode !== "cleanup") ||
      args.some((arg, index) => index > 0 && arg !== "--local")
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Neon action usage: provision|cleanup [--local]" }),
      );
    }

    const local = args.includes("--local");
    const context = yield* loadPreviewContext(local);
    const credentials = yield* loadNeonDatabaseCredentials("preview");
    const adapter = createNeonDatabaseAdapter(credentials);

    yield* Effect.acquireUseRelease(
      context.state.lock(context.owner),
      () =>
        Effect.gen(function* () {
          if (mode === "cleanup") {
            const failures: number[] = [];

            for (const manifest of yield* context.state.list(context.owner)) {
              if (manifest.status === "deleting") {
                yield* cleanupPreviewDatabase(manifest, adapter, context.state).pipe(
                  Effect.catchTag("PreviewFailure", () =>
                    Effect.sync(() => {
                      failures.push(manifest.owner.pr);
                    }),
                  ),
                );
              }
            }

            if (failures.length > 0) {
              return yield* Effect.fail(
                new PreviewFailure({
                  operation: "Preview database cleanup incomplete; manifests retained",
                }),
              );
            }

            return yield* Effect.void;
          }

          const runId = process.env["RUN_ID"];
          const pr = Number(process.env["PR"]);

          const target = yield* Effect.gen(function* () {
            if (!local && runId !== undefined && runId !== "") {
              return yield* resolvePreviewRun(context.repository, runId, "deploy");
            }

            return { ...(yield* readPreviewPullRequest(context.repository, pr)), pr };
          });

          if (target.state !== "open" || target.repositoryId !== context.owner.repositoryId) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Preview database PR target invalid" }),
            );
          }

          const handoff = yield* provisionPreviewDatabase(
            {
              owner: { ...context.owner, pr: target.pr },
              head: target.head,
              sandbox: context.credentials.sandbox,
            },
            createNeonDatabaseIdentity(credentials),
            adapter,
            context.state,
          );

          const current = yield* readPreviewPullRequest(context.repository, target.pr);

          if (current.state !== "open" || current.head !== target.head) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Preview PR changed during database provisioning" }),
            );
          }

          yield* writeDatabaseHandoff(previewString(process.env["DATABASE_OUTPUT_FILE"]), handoff);
          return yield* Effect.void;
        }),
      (etag) => context.state.unlock(context.owner, etag).pipe(Effect.orDie),
    );

    return yield* Effect.void;
  });

if (process.argv[1] !== undefined && import.meta.filename === nodePath.resolve(process.argv[1])) {
  try {
    await Effect.runPromise(runNeonPreviewAction(process.argv.slice(cliArgumentOffset)));
  } catch {
    process.stderr.write(
      "Neon preview action failed; provider and connection details suppressed\n",
    );

    process.exitCode = 1;
  }
}
