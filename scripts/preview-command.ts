import { execFileSync } from "node:child_process";
import nodePath from "node:path";
import { Effect } from "effect";
import { PreviewFailure } from "./preview-model.ts";
import type { PreviewCredentials } from "./preview-cloudflare.ts";

const wrangler = nodePath.resolve("node_modules/wrangler/bin/wrangler.js");

/** Never invoke a shell, PR package hooks or inherited Doppler/GitHub credentials. */
export const runPreviewWrangler = (credentials: PreviewCredentials, args: string[]) =>
  Effect.try({ try: () => execFileSync(process.execPath, [wrangler, ...args], {
      cwd: "/tmp", timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8", stdio: "pipe",
      env: { PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp/preview-wrangler-home",
        CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
        CLOUDFLARE_API_TOKEN: credentials.token },
    }), catch: () => new PreviewFailure({ operation: "Preview Wrangler operation failed; output suppressed" }) });
