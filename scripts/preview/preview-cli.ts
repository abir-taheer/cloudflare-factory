import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure } from "./preview-model.ts";
import { loadPreviewContext } from "./preview-context.ts";
import { previewPublicUrls } from "./cloudflare/preview-worker-config.ts";
import { verifyPreviewDeployment } from "./auth/preview-verify.ts";
import { deployPreviewEnvironment } from "./lifecycle/preview-deploy.ts";
import {
  cleanupPreviewEnvironment,
  previewCleanupRetryPolicy,
} from "./lifecycle/preview-cleanup.ts";
import { reconcilePreviewEnvironments } from "./lifecycle/preview-reconcile.ts";
import { readPreviewPullRequest, resolvePreviewRun } from "./preview-github.ts";

const cliArgumentOffset = 2;

interface PreviewCommandTarget {
  head: string;
  state: unknown;
  repositoryId: string;
  pr: number;
}

function parsePreviewArguments(args: string[]) {
  const operation = args[0];

  if (
    operation !== "deploy" &&
    operation !== "destroy" &&
    operation !== "reconcile" &&
    operation !== "verify"
  ) {
    throw new PreviewFailure({
      operation:
        "Preview usage: deploy|destroy|reconcile|verify [--local] [--pr NUMBER] [--artifacts PATH]",
    });
  }

  const flags = new Map<string, string>();

  for (let index = 1; index < args.length; index++) {
    const flag = args[index];

    const isKnownFlag = flag !== undefined && ["--local", "--pr", "--artifacts"].includes(flag);

    if (!isKnownFlag || flags.has(flag)) {
      throw new PreviewFailure({ operation: "Preview CLI flag invalid" });
    }

    if (flag === "--local") {
      flags.set(flag, "true");
    } else {
      const value = args[(index += 1)];

      if (value === undefined || value.startsWith("--")) {
        throw new PreviewFailure({ operation: "Preview CLI value missing" });
      }

      flags.set(flag, value);
    }
  }

  const local = flags.has("--local");
  return { operation, flags, local };
}

/** Explicit local mode requires Docker, Doppler scope checks and the same account readback as CI. */
export const runPreviewCommand = (args: string[]) =>
  Effect.gen(function* () {
    const { operation, flags, local } = parsePreviewArguments(args);
    const context = yield* loadPreviewContext(local);
    const { repository, credentials, cf, state } = context;
    const runId = process.env["RUN_ID"];
    let target: PreviewCommandTarget | null = null;

    if (operation !== "reconcile") {
      if (!local && runId !== undefined && runId !== "") {
        target = yield* resolvePreviewRun(
          repository,
          runId,
          operation === "deploy" ? "deploy" : "destroy",
        );
      } else {
        target = {
          ...(yield* readPreviewPullRequest(repository, Number(flags.get("--pr")))),
          pr: Number(flags.get("--pr")),
        };
      }
    }

    if (target && target.repositoryId !== context.owner.repositoryId) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview repository changed" }));
    }

    const owner = { ...context.owner, pr: target?.pr ?? 1 };

    if (operation === "verify") {
      if (!local) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview access commands require explicit local mode" }),
        );
      }

      const manifest = yield* state.load(owner);

      if (manifest?.status !== "ready" || Date.parse(manifest.expiresAt) <= Date.now()) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview access requires a ready unexpired manifest" }),
        );
      }

      yield* verifyPreviewDeployment(previewPublicUrls(manifest, credentials), {
        manifest,
        credentials,
      });

      return yield* Effect.void;
    }

    yield* Effect.acquireUseRelease(
      state.lock(owner),
      () =>
        Effect.gen(function* () {
          if (operation === "reconcile") {
            return yield* reconcilePreviewEnvironments(repository, owner, credentials, cf, state);
          }

          if (!target) {
            return yield* Effect.fail(new PreviewFailure({ operation: "Preview target missing" }));
          }

          if (operation === "deploy") {
            // Re-check after lock acquisition to reject stale queued deployments.
            const current = yield* readPreviewPullRequest(repository, target.pr);

            if (current.state !== "open" || current.head !== target.head) {
              return yield* Effect.fail(
                new PreviewFailure({ operation: "Preview PR changed while waiting" }),
              );
            }

            const head = current.head;

            const verifyCurrent = readPreviewPullRequest(repository, target.pr).pipe(
              Effect.flatMap((latest) => {
                if (latest.state === "open" && latest.head === head) {
                  return Effect.void;
                }

                return Effect.fail(
                  new PreviewFailure({ operation: "Preview PR changed during deployment" }),
                );
              }),
            );

            yield* deployPreviewEnvironment(
              owner,
              { head, verifyCurrent },
              nodePath.resolve(flags.get("--artifacts") ?? "preview-artifact"),
              credentials,
              cf,
              state,
            );
          } else {
            const manifest = yield* state.load(owner);

            if (manifest) {
              yield* cleanupPreviewEnvironment(manifest, credentials, cf, state).pipe(
                Effect.retry(previewCleanupRetryPolicy),
              );
            } else {
              process.stdout.write("Preview has no ownership manifest; no resources deleted");
            }
          }

          return yield* Effect.void;
        }),
      (etag) => state.unlock(owner, etag).pipe(Effect.orDie),
    );

    return yield* Effect.void;
  });

if (process.argv[1] !== undefined && import.meta.filename === nodePath.resolve(process.argv[1])) {
  try {
    await Effect.runPromise(
      runPreviewCommand(process.argv.slice(cliArgumentOffset)).pipe(
        Effect.catchTag("PreviewFailure", (error) =>
          Effect.sync(() => {
            process.stderr.write(`${error.operation}\n`);
            process.exitCode = 1;
          }),
        ),
      ),
    );
  } catch {
    process.stderr.write("Preview lifecycle failed; provider details suppressed\n");
    process.exitCode = 1;
  }
}
