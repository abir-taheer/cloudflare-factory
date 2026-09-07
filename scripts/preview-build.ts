import { cp, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { build } from "esbuild";
import { Effect } from "effect";
import { previewIo } from "./preview-model.ts";

/** Build artifacts without credentials; only flat bundled modules and ordinary assets cross the boundary. */
export const buildPreviewArtifacts = (source: string, output: string) => previewIo("Preview artifact build failed", async () => {
  const sourceRoot = nodePath.resolve(source);
  const outputRoot = nodePath.resolve(output);
  await mkdir(outputRoot, { recursive: true });
  for (const app of ["api", "workflows", "frontend"]) {
    await build({ entryPoints: [nodePath.resolve(sourceRoot, `apps/${app}/src/cloudflare-${app}.ts`)],
      outfile: nodePath.resolve(outputRoot, `${app}.mjs`), bundle: true, format: "esm", platform: "node",
      target: "es2022", conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"],
      external: ["cloudflare:*", "node:*"], sourcemap: false, logLevel: "silent",
      // workerd does not expose import.meta.url with this compatibility configuration.
      banner: { js: 'import { createRequire as previewCreateRequire } from "node:module"; const require = previewCreateRequire("/worker.js");' } });
  }
  const assets = nodePath.resolve(sourceRoot, "apps/frontend/public");
  const check = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const path = nodePath.resolve(directory, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Special asset file rejected");
      if (stat.isDirectory()) await check(path);
    }
  };
  await check(assets);
  await cp(assets, nodePath.resolve(outputRoot, "assets"), { recursive: true, dereference: false });
  const schema = nodePath.resolve(sourceRoot, "infra/d1.sql");
  const schemaStat = await lstat(schema);
  if (!schemaStat.isFile()) throw new Error("Expected schema file");
  await writeFile(nodePath.resolve(outputRoot, "schema.sql"), await readFile(schema, "utf8"));
});

if (process.argv[1] !== undefined && import.meta.filename === nodePath.resolve(process.argv[1])) {
  try { await Effect.runPromise(buildPreviewArtifacts(process.argv[2] ?? ".", process.argv[3] ?? "/tmp/preview-build")); }
  catch { process.stderr.write("Preview artifact build failed\n"); process.exitCode = 1; }
}
