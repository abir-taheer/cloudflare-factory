import { cp, lstat, readdir, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import { derivePreviewSessionSecret, previewIo } from "../preview-model.ts";
import type { PreviewOwner } from "../preview-model.ts";

/** Prepare public runtime assets and private session secrets outside the artifact tree. */
export function preparePreviewRuntimeFiles(
  directory: string,
  artifactRoot: string,
  apiUrl: string,
  baseSecret: string,
  owner: PreviewOwner,
) {
  return Effect.gen(function* () {
    const frontendAssets = nodePath.join(directory, "assets");

    yield* previewIo("Preview public runtime configuration failed", async () => {
      await cp(nodePath.join(artifactRoot, "assets"), frontendAssets, { recursive: true });

      await writeFile(
        nodePath.join(frontendAssets, "runtime-config.json"),
        JSON.stringify({ API_URL: apiUrl, ENVIRONMENT: "preview" }),
        { mode: 0o600 },
      );
    });

    const secrets = nodePath.join(directory, "secrets.json");

    yield* previewIo("Preview runtime secret preparation failed", () =>
      writeFile(
        secrets,
        JSON.stringify({
          BETTER_AUTH_SECRET: derivePreviewSessionSecret(baseSecret, owner),
        }),
        { mode: 0o600 },
      ),
    );

    return { frontendAssets, secrets };
  });
}

const artifactLimitBytes = 26_214_400;
const artifactFileLimit = 2000;

/** A credential-free artifact is data only; reject links, extra files and excessive input. */
export const validatePreviewArtifacts = (root: string) =>
  previewIo("Preview artifact validation failed", async () => {
    const expected = ["api.mjs", "workflows.mjs", "frontend.mjs", "assets"];
    const entries = await readdir(root);

    if (entries.length !== expected.length || entries.some((entry) => !expected.includes(entry))) {
      throw new Error("Unexpected artifact");
    }

    let bytes = 0;
    let count = 0;

    const inspect = async (path: string): Promise<void> => {
      const stat = await lstat(path);

      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error("Special file");
      }

      count += 1;

      if (count > artifactFileLimit || (bytes += stat.size) > artifactLimitBytes) {
        throw new Error("Artifact limit");
      }

      if (stat.isDirectory()) {
        for (const name of await readdir(path)) {
          await inspect(nodePath.join(path, name));
        }
      }
    };

    await inspect(root);

    for (const entry of expected.filter((name) => name !== "assets")) {
      const stat = await lstat(nodePath.join(root, entry));

      if (!stat.isFile()) {
        throw new Error("Expected regular file");
      }
    }

    const stat = await lstat(nodePath.join(root, "assets"));

    if (!stat.isDirectory()) {
      throw new Error("Expected assets directory");
    }
  });
