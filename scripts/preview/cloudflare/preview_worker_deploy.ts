import { deployPreviewDomains } from "../domains/preview_domain_deploy.ts";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewResource } from "../preview_model.ts";
import type { PreviewManifest, PreviewResource } from "../preview_model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "./preview_cloudflare.ts";
import type { PreviewStateStore } from "../lifecycle/preview_state.ts";
import {
  type loadPreviewRuntimeBaselines,
  renderPreviewWorkerConfig,
} from "./preview_worker_config.ts";
import { runPreviewWrangler } from "./preview_command.ts";
import { preparePreviewResource } from "../lifecycle/preview_resource_intent.ts";

export interface PreviewDeploymentRevision {
  head: string;
  verifyCurrent: Effect.Effect<void, PreviewFailure>;
}

/** Publish dependency-ordered Workers with exact-head checks before every mutation. */
interface PreviewWorkerDeployment {
  manifest: PreviewManifest;
  revision: PreviewDeploymentRevision;
  artifactRoot: string;
  credentials: PreviewCredentials;
  cf: PreviewCloudflare;
  state: PreviewStateStore;
  runtimes: Effect.Success<ReturnType<typeof loadPreviewRuntimeBaselines>>;
  directory: string;
  frontendAssets: string;
  secrets: string;
}

export function deployPreviewWorkers(deployment: PreviewWorkerDeployment) {
  const {
    manifest,
    revision,
    artifactRoot,
    credentials,
    cf,
    state,
    runtimes,
    directory,
    frontendAssets,
    secrets,
  } = deployment;

  return Effect.gen(function* () {
    for (const app of ["workflows", "api", "frontend"] as const) {
      yield* revision.verifyCurrent;

      const worker = previewResource(manifest, app);
      yield* preparePreviewResource(manifest, worker, cf, state);

      let dependents: PreviewResource[] = [];

      if (app === "workflows") {
        dependents = manifest.resources.filter((item) =>
          ["workflow", "do", "container"].includes(item.kind),
        );
      }

      for (const child of dependents) {
        yield* preparePreviewResource(manifest, child, cf, state);
      }

      const config = renderPreviewWorkerConfig(
        manifest,
        credentials,
        app,
        nodePath.resolve(artifactRoot),
      );

      config["vars"] = { ...runtimes[app].vars, ...previewRecord(config["vars"]) };

      if (app === "frontend") {
        config["assets"] = { ...previewRecord(config["assets"]), directory: frontendAssets };
      }

      const path = nodePath.join(directory, `${app}.json`);

      yield* previewIo("Preview Worker configuration failed", () =>
        writeFile(path, JSON.stringify(config), { mode: 0o600 }),
      );

      yield* runPreviewWrangler(credentials, [
        "deploy",
        "--config",
        path,
        "--no-bundle",
        ...(app === "api" ? ["--secrets-file", secrets] : []),
      ]);

      for (const item of [worker, ...dependents]) {
        item.id = yield* cf.lookupResource(item);

        if (item.id === null) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview deployed resource readback failed" }),
          );
        }

        item.phase = "ready";
        yield* state.save(manifest);
      }
    }

    yield* deployPreviewDomains(manifest, credentials, cf, state, revision);
    return yield* Effect.void;
  });
}
