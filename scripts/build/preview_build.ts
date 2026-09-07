import { buildPreviewMigrationArtifact } from "../preview/database/preview_migration_artifact.ts";
import { promisify } from "node:util";
import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import { ConfigProvider, Effect } from "effect";
import { buildWorker } from "./build_worker.ts";
import { previewIo } from "../preview/preview_model.ts";

// oxlint-disable-next-line typescript/strict-void-return -- Node promisify deliberately ignores the ChildProcess returned by execFile and awaits its completion callback.
const executeBuildCommand = promisify(execFile);

/** Build artifacts without credentials; only flat bundled modules and ordinary assets cross the boundary. */
export const buildPreviewArtifacts = (source: string, output: string) =>
  Effect.gen(function* () {
    const pathSetting = yield* ConfigProvider.fromEnv().load(["PATH"]);

    yield* previewIo("Preview artifact build failed", async () => {
      const sourceRoot = nodePath.resolve(source);
      const outputRoot = nodePath.resolve(output);
      await mkdir(outputRoot, { recursive: true });

      for (const app of ["api", "workflows", "frontend"]) {
        await buildWorker(
          nodePath.resolve(sourceRoot, `apps/${app}/src/cloudflare_${app}.ts`),
          nodePath.resolve(outputRoot, `${app}.mjs`),
        );
      }

      await executeBuildCommand("npm", ["run", "build", "--workspace", "@factory/frontend"], {
        cwd: sourceRoot,
        env: {
          PATH: pathSetting?.value ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          NODE_ENV: "production",
        },
        timeout: 120_000,
        maxBuffer: 1_048_576,
      });

      const assets = nodePath.resolve(sourceRoot, "apps/frontend/dist");

      const check = async (directory: string): Promise<void> => {
        for (const name of await readdir(directory)) {
          const path = nodePath.resolve(directory, name);
          const stat = await lstat(path);

          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
            throw new Error("Special asset file rejected");
          }

          if (stat.isDirectory()) {
            await check(path);
          }
        }
      };

      await check(assets);

      await cp(assets, nodePath.resolve(outputRoot, "assets"), {
        recursive: true,
        dereference: false,
      });
    });

    yield* buildPreviewMigrationArtifact(source, output);
  }).pipe(Effect.withSpan("preview.artifacts.build"));
