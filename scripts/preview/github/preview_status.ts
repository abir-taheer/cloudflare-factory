import { Config, Effect } from "effect";
import { z } from "zod";
import { previewIo } from "../preview_model.ts";
import { previewGithubRequest, resolvePreviewRun } from "./preview_github.ts";

const previewStatusTimeoutMs = 30_000;

const PreviewStatusConfigurationSchema = z.strictObject({
  GITHUB_EVENT_NAME: z.literal("workflow_run"),
  GITHUB_REF: z.string().startsWith("refs/heads/"),
  GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  GITHUB_RUN_ID: z.string().regex(/^\d+$/u),
  GITHUB_TOKEN: z.string().min(1),
  RUN_ID: z.string().regex(/^\d+$/u),
});

const PreviewRepositoryMetadataSchema = z.object({ default_branch: z.string().min(1) });

/** Status credentials belong only to the trusted workflow, never the PR build. */
export const previewStatusConfiguration = Config.all({
  GITHUB_EVENT_NAME: Config.string("GITHUB_EVENT_NAME"),
  GITHUB_REF: Config.string("GITHUB_REF"),
  GITHUB_REPOSITORY: Config.string("GITHUB_REPOSITORY"),
  GITHUB_RUN_ID: Config.string("GITHUB_RUN_ID"),
  GITHUB_TOKEN: Config.string("GITHUB_TOKEN"),
  RUN_ID: Config.string("RUN_ID"),
}).pipe(Config.map((value) => PreviewStatusConfigurationSchema.parse(value)));

/** A missing or pending result cannot satisfy the PR's required preview status. */
export const PreviewStatusStateSchema = z.enum(["pending", "success", "failure"]);

/** Publish only for an open internal PR's current, provenance-verified build revision. */
export const publishPreviewStatus = (
  configuration: z.infer<typeof PreviewStatusConfigurationSchema>,
  state: z.infer<typeof PreviewStatusStateSchema>,
) =>
  Effect.gen(function* () {
    const repository = configuration.GITHUB_REPOSITORY;

    const metadata = PreviewRepositoryMetadataSchema.parse(
      yield* previewGithubRequest(`/repos/${repository}`),
    );

    const expectedRef = `refs/heads/${metadata.default_branch}`;

    if (configuration.GITHUB_REF !== expectedRef) {
      throw new Error("Preview status requires the default branch controller");
    }

    const target = yield* resolvePreviewRun(repository, configuration.RUN_ID, "deploy");

    const descriptions = {
      pending: "Deploying and verifying this PR revision",
      success: "Isolated preview deployed and verified",
      failure: "Preview deployment or verification failed",
    };

    yield* previewIo("Preview commit status publication failed", async () => {
      const response = await fetch(
        `https://api.github.com/repos/${repository}/statuses/${target.head}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(previewStatusTimeoutMs),
          headers: {
            Authorization: `Bearer ${configuration.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            state,
            context: "Preview verified",
            description: descriptions[state],
            target_url: `https://github.com/${repository}/actions/runs/${configuration.GITHUB_RUN_ID}`,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("GitHub rejected preview status");
      }
    });
  });
