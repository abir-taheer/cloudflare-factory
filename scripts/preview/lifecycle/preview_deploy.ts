import type { PreviewDeploymentRevision } from "../cloudflare/preview_worker_deploy.ts";
import { provisionPreviewDataResources } from "./preview_resource_intent.ts";
import { deployPreviewWorkers } from "../cloudflare/preview_worker_deploy.ts";
import {
  acquirePreviewRuntimeDirectory,
  preparePreviewRuntimeFiles,
  validatePreviewArtifacts,
} from "../cloudflare/preview_runtime_files.ts";
import { Effect } from "effect";
import { PreviewFailure, previewString } from "../preview_model.ts";
import type { PreviewManifest, PreviewOwner } from "../preview_model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview_cloudflare.ts";
import type { PreviewStateStore } from "./preview_state.ts";
import {
  loadPreviewRuntimeBaselines,
  previewPublicUrls,
} from "../cloudflare/preview_worker_config.ts";
import { verifyPreviewDeployment } from "../auth/preview_verify.ts";
import { writePreviewSummary } from "../github/preview_summary.ts";

const previewLifetimeMs = 604_800_000;

function completePreviewDeployment(
  manifest: PreviewManifest,
  state: PreviewStateStore,
  urls: ReturnType<typeof previewPublicUrls>,
) {
  return Effect.gen(function* () {
    manifest.status = "ready";
    yield* state.save(manifest);

    yield* writePreviewSummary(manifest, urls);

    process.stdout.write(
      `Preview ready for PR #${manifest.owner.pr}: ${urls.frontend} (API: ${urls.api})\n`,
    );
  });
}

/** Provision empty PR resources, deploy dependency-first, and verify behavior before marking ready. */
export const deployPreviewEnvironment = (
  owner: PreviewOwner,
  revision: PreviewDeploymentRevision,
  artifactRoot: string,
  credentials: PreviewCredentials,
  cf: PreviewCloudflare,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const head = revision.head;
    yield* validatePreviewArtifacts(artifactRoot);

    const runtimes = yield* loadPreviewRuntimeBaselines();
    const manifest = yield* state.load(owner);

    if (
      manifest?.database === null ||
      manifest === null ||
      manifest.status === "deleted" ||
      manifest.status === "deleting" ||
      manifest.sandbox !== credentials.sandbox ||
      manifest.head !== head
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview database composite action must complete first" }),
      );
    }

    const urls = previewPublicUrls(manifest, credentials);

    manifest.status = "deploying";
    manifest.expiresAt = new Date(Date.now() + previewLifetimeMs).toISOString();
    yield* state.save(manifest);

    yield* provisionPreviewDataResources(manifest, cf, state, artifactRoot);

    const directory = yield* acquirePreviewRuntimeDirectory;

    yield* Effect.gen(function* () {
      const { frontendAssets, secrets } = yield* preparePreviewRuntimeFiles(
        directory,
        artifactRoot,
        urls.api,
        previewString(runtimes.api.secrets["BETTER_AUTH_SECRET"]),
        owner,
      );

      yield* deployPreviewWorkers({
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
      });

      yield* verifyPreviewDeployment(urls, { manifest, credentials });
      yield* revision.verifyCurrent;
      yield* completePreviewDeployment(manifest, state, urls);

      return yield* Effect.void;
    });

    return yield* Effect.void;
  }).pipe(Effect.scoped);
