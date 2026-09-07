import type { PreviewDeploymentRevision } from "../cloudflare/preview-worker-deploy.ts";
import { provisionPreviewDataResources } from "./preview-resource-intent.ts";
import { deployPreviewWorkers } from "../cloudflare/preview-worker-deploy.ts";
import {
  preparePreviewRuntimeFiles,
  validatePreviewArtifacts,
} from "../cloudflare/preview-runtime-files.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { Effect } from "effect";
import { PreviewFailure, previewIo, previewString } from "../preview-model.ts";
import type { PreviewManifest, PreviewOwner } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "../cloudflare/preview-cloudflare.ts";
import type { PreviewStateStore } from "./preview-state.ts";
import {
  loadPreviewRuntimeBaselines,
  previewPublicUrls,
} from "../cloudflare/preview-worker-config.ts";
import { verifyPreviewDeployment } from "../auth/preview-verify.ts";

const previewLifetimeMs = 604_800_000;

function completePreviewDeployment(
  manifest: PreviewManifest,
  state: PreviewStateStore,
  urls: ReturnType<typeof previewPublicUrls>,
) {
  return Effect.gen(function* () {
    manifest.status = "ready";
    yield* state.save(manifest);

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

    manifest.status = "deploying";
    manifest.expiresAt = new Date(Date.now() + previewLifetimeMs).toISOString();
    yield* state.save(manifest);

    yield* provisionPreviewDataResources(manifest, cf, state);

    const directory = yield* previewIo("Preview temporary directory failed", () =>
      mkdtemp("/tmp/preview-deploy-"),
    );

    const urls = previewPublicUrls(manifest, credentials);

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
    }).pipe(
      Effect.ensuring(
        previewIo("Preview temporary file removal failed", () =>
          rm(directory, { recursive: true, force: true }),
        ).pipe(Effect.orDie),
      ),
    );

    return yield* Effect.void;
  });
