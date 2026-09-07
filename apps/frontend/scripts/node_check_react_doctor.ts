/* eslint-disable import/no-nodejs-modules -- This is the Node-only lint command entrypoint. */
import { rmdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ReactDoctorReportSchema } from "./react_doctor_report.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const scannerPath = fileURLToPath(
  new URL("../../../node_modules/react-doctor/dist/cli.js", import.meta.url),
);

const auditDirectory = new URL("../.react-doctor/", import.meta.url);
const FileSystemFailureSchema = z.object({ code: z.string() });

const scannerTimeoutMs = 120_000;
const maximumReportBytes = 16_777_216;
const maximumDiagnosticCharacters = 262_144;

const ReactDoctorFailureSchema = z.object({
  message: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

// eslint-disable-next-line typescript/strict-void-return -- Node promisify supports execFile via its documented custom promisify adapter.
const executeFile = promisify(execFile);
let scannerOutput = "";
let scannerErrors = "";

try {
  // eslint-disable-next-line node/no-top-level-await -- ESM-only lint command; never required as a library.
  const result = await executeFile(
    process.execPath,
    [
      scannerPath,
      "apps/frontend",
      "--scope",
      "full",
      "--yes",
      "--blocking",
      "warning",
      "--no-cache",
      "--no-score",
      "--no-telemetry",
      "--no-supply-chain",
      "--no-respect-inline-disables",
      "--json",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: scannerTimeoutMs,
      maxBuffer: maximumReportBytes,
    },
  );

  scannerOutput = result.stdout;
  scannerErrors = result.stderr;

  const value: unknown = JSON.parse(scannerOutput);
  const parsed = ReactDoctorReportSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`React Doctor incomplete or invalid report: ${parsed.error.message}`);
  }

  const report = parsed.data;

  process.stdout.write(
    `React Doctor complete: ${report.projects.length} project(s), zero findings.\n`,
  );
} catch (error) {
  process.stderr.write(
    "React Doctor gate failed: findings, invalid output, incomplete scan, or process timeout.\n",
  );

  const failure = ReactDoctorFailureSchema.safeParse(error);

  if (failure.success) {
    for (const output of [
      failure.data.message,
      failure.data.stdout ?? scannerOutput,
      failure.data.stderr ?? scannerErrors,
    ]) {
      if (output !== undefined) {
        process.stderr.write(`${output.slice(0, maximumDiagnosticCharacters)}\n`);
      }
    }
  }

  process.exitCode = 1;
}

try {
  // eslint-disable-next-line node/no-top-level-await -- ESM-only lint command cleanup after scanner restores its audit backups.
  await rmdir(auditDirectory);
} catch (error) {
  const failure = FileSystemFailureSchema.safeParse(error);

  if (!failure.success || failure.data.code !== "ENOENT") {
    process.stderr.write(
      "React Doctor audit cleanup failed; retained files need inspection before another scan.\n",
    );

    process.exitCode = 1;
  }
}
