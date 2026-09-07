import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from "node:child_process";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure } from "../preview-model.ts";
import type { PreviewCredentials } from "./preview-cloudflare.ts";

const wranglerTimeoutMs = 300_000;
const wranglerOutputLimitBytes = 8_388_608;

/** Execute a trusted program asynchronously with an explicitly restricted environment. */
export const executePreviewFile = promisify(
  (
    file: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding,
    callback: (error: ExecFileException | null, stdout: string) => void,
  ): void => {
    execFile(file, args, options, callback);
  },
);

const wrangler = nodePath.resolve("node_modules/wrangler/bin/wrangler.js");

/** Never invoke a shell, PR package hooks or inherited Doppler/GitHub credentials. */
export const runPreviewWrangler = (credentials: PreviewCredentials, args: string[]) =>
  Effect.tryPromise({
    try: async () => {
      const result = await executePreviewFile(process.execPath, [wrangler, ...args], {
        cwd: "/tmp",
        timeout: wranglerTimeoutMs,
        maxBuffer: wranglerOutputLimitBytes,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp/preview-wrangler-home",
          CI: "true",
          WRANGLER_SEND_METRICS: "false",
          CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
          CLOUDFLARE_API_TOKEN: credentials.token,
        },
      });

      return result;
    },
    catch: () =>
      new PreviewFailure({ operation: "Preview Wrangler operation failed; output suppressed" }),
  });
