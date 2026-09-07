import { appendFile } from "node:fs/promises";
import { Config, Effect } from "effect";
import { z } from "zod";
import type { PreviewManifest } from "../preview_model.ts";
import { previewIo } from "../preview_model.ts";
import type { previewPublicUrls } from "../cloudflare/preview_worker_config.ts";

const summaryPath = Config.string("GITHUB_STEP_SUMMARY").pipe(
  Config.withDefault(""),
  Config.map((value) => z.enum(["", "/preview-summary"]).parse(value)),
);

/** Publish public preview links only after verification; credentials never enter the summary. */
export const writePreviewSummary = (
  manifest: PreviewManifest,
  urls: ReturnType<typeof previewPublicUrls>,
) =>
  Effect.gen(function* () {
    const path = yield* summaryPath;

    if (path === "") {
      return yield* Effect.void;
    }

    const markdown = [
      `## Verified preview for PR #${manifest.owner.pr}`,
      `Revision: \`${manifest.head}\``,
      `- [Frontend](${urls.frontend})`,
      `- [API](${urls.api})`,
      "",
      "Signup, captured email verification, session, database, workflow and browser checks passed.",
      "",
    ].join("\n\n");

    yield* previewIo("Preview summary publication failed", () => appendFile(path, markdown));
    return yield* Effect.void;
  });
