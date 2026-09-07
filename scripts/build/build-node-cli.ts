import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { Effect } from "effect";
import { build } from "esbuild";
import { bundleWorkflowCode } from "@temporalio/worker";
import { z } from "zod";

const NodeBuildAppSchema = z.enum(["api", "frontend", "workflows", "executor"]);

const program = Effect.tryPromise(async () => {
  const app = NodeBuildAppSchema.parse(process.argv[2]);
  const root = nodePath.resolve(import.meta.dirname, "../..");
  const directory = nodePath.join(root, "apps", app);
  const output = nodePath.join(directory, "dist");
  const external: string[] = [];

  if (app === "workflows") {
    external.push("@temporalio/*");
  }

  await build({
    entryPoints: [nodePath.join(directory, "src", `node-${app}.ts`)],
    outfile: nodePath.join(output, `node-${app}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external,
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    sourcemap: false,
    minify: true,
    keepNames: true,
    logLevel: "info",
  });

  if (app === "workflows") {
    const bundle = await bundleWorkflowCode({
      workflowsPath: nodePath.join(directory, "src/temporal-workflow.ts"),
    });

    await writeFile(nodePath.join(output, "temporal-workflow-bundle.js"), bundle.code);
  }
});

await Effect.runPromise(program);
