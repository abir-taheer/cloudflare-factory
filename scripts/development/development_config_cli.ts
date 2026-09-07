import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { validateDevelopmentConfiguration } from "./development_configuration.ts";

const nodeArgumentCount = 2;

const validateDevelopmentFiles = Effect.tryPromise(async () => {
  const [directory, ...projects] = process.argv.slice(nodeArgumentCount);

  if (directory === undefined || !/^\.local\/doppler-dev\.[\w-]+$/u.test(directory)) {
    throw new Error("Development Doppler private directory required");
  }

  const baselineText = await readFile(`${directory}/base.json`, "utf8");
  const resolvedText = await readFile(`${directory}/resolved.json`, "utf8");
  const baseline: unknown = JSON.parse(baselineText);
  const resolved: unknown = JSON.parse(resolvedText);
  const downloads: Record<string, unknown> = {};

  for (const app of ["api", "frontend", "workflows"]) {
    const text = await readFile(`${directory}/${app}.json`, "utf8");
    downloads[app] = JSON.parse(text);
  }

  validateDevelopmentConfiguration(baseline, resolved, projects, downloads);
});

try {
  await Effect.runPromise(validateDevelopmentFiles);
} catch {
  process.stderr.write("Development Doppler configuration rejected; values suppressed\n");
  process.exitCode = 1;
}
