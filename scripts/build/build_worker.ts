import nodePath from "node:path";
import { build } from "esbuild";
import { z } from "zod";

const BuildFailureSchema = z.object({
  errors: z.array(
    z.object({
      text: z.string(),
      location: z.nullable(z.object({ file: z.string(), line: z.number(), column: z.number() })),
    }),
  ),
});

const diagnosticTextLimit = 500;
const diagnosticCountLimit = 10;

function redactBuildDiagnostic(value: string): string {
  return value
    .replaceAll(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/giu, "[redacted URL]")
    .replaceAll(/\bBearer\s+[^\s"'<>]+/giu, "Bearer [redacted]")
    .replaceAll(
      /(?<key>[\w-]*(?:token|secret|password|api[_-]?key|access[_-]?key|connection[_-]?string)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$<key>[redacted]",
    )
    .replaceAll(/\p{Cc}/gu, " ")
    .slice(0, diagnosticTextLimit);
}

/** Only compiler locations and redacted descriptions leave this credential-free build boundary. */
export function workerBuildDiagnostics(error: unknown): string {
  try {
    const result = BuildFailureSchema.safeParse(error);

    if (!result.success) {
      return "Worker compilation failed without structured compiler diagnostics";
    }

    return result.data.errors
      .slice(0, diagnosticCountLimit)
      .map((item) => {
        const location = item.location;
        let label = "bundle";

        if (location !== null) {
          label = `${redactBuildDiagnostic(location.file)}:${location.line}:${location.column + 1}`;
        }

        return `${label}: ${redactBuildDiagnostic(item.text)}`;
      })
      .join("\n");
  } catch {
    return "Worker compilation failed without structured compiler diagnostics";
  }
}

/** Shared Worker bundling for local artifacts and trusted preview builds; never executes the output. */
export const buildWorker = async (entryPoint: string, output: string) => {
  try {
    return await build({
      entryPoints: [nodePath.resolve(entryPoint)],
      outfile: nodePath.resolve(output),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "es2022",
      conditions: ["workerd", "worker", "browser"],
      mainFields: ["module", "main"],
      external: ["cloudflare:*", "node:*"],
      sourcemap: false,
      logLevel: "silent",
      // Use an absolute module base: Workers do not expose import.meta.url with these compatibility settings.
      banner: {
        js: 'import { createRequire as previewCreateRequire } from "node:module"; const require = previewCreateRequire("/worker.js");',
      },
    });
  } catch (error) {
    process.stderr.write(`${workerBuildDiagnostics(error)}\n`);
    // oxlint-disable-next-line preserve-caught-error -- Raw compiler errors can contain source secrets; only sanitized diagnostics may escape.
    throw new Error("Worker artifact compilation failed");
  }
};

if (process.argv[1] !== undefined && import.meta.filename === nodePath.resolve(process.argv[1])) {
  const entryPoint = process.argv[2];
  const output = process.argv[3];

  if (entryPoint === undefined || entryPoint === "" || output === undefined || output === "") {
    throw new Error("Usage: build_worker.ts entry-point output-file");
  }

  await buildWorker(entryPoint, output);
}
