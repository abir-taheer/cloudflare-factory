import { promisify } from "node:util";
import { type ExecFileException, type ExecFileOptions, execFile } from "node:child_process";
import nodePath from "node:path";
import { Effect } from "effect";
import { previewIo, previewRecord, previewString } from "../preview/preview-model.ts";

type ProductionProcessCompletion = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

/** Run bounded child processes asynchronously while retaining piped, non-inherited output. */
export const executeProductionFile = promisify(
  (
    file: string,
    args: string[],
    options: ExecFileOptions,
    complete: ProductionProcessCompletion,
  ) => {
    execFile(file, args, { ...options, encoding: "utf8" }, complete);
  },
);

const maximumWranglerOutputBytes = 8_388_608;
const wranglerTimeoutMs = 300_000;
const controlRequestTimeoutMs = 30_000;
const httpNotFound = 404;

/** Management credentials never enter app bindings, test requests or child process inheritance. */
export interface ProductionCredentials {
  readonly accountId: string;
  readonly token: string;
}

/** Bounded Cloudflare control-plane requests suppress provider bodies and reject redirects. */
export const productionRequest = (
  credentials: ProductionCredentials,
  path: string,
  method = "GET",
  body?: unknown,
) =>
  previewIo("Production Cloudflare request failed", async () => {
    if (!path.startsWith("/") || path.includes("..")) {
      throw new Error("Production control path invalid");
    }

    const requestBody: RequestInit = {};

    if (body !== undefined) {
      requestBody.body = JSON.stringify(body);
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
        },
        ...requestBody,
        redirect: "error",
        signal: AbortSignal.timeout(controlRequestTimeoutMs),
      },
    );

    if (response.status === httpNotFound && method === "GET") {
      return null;
    }

    if (!response.ok) {
      throw new Error("Production provider rejected request");
    }

    const responseBody = await response.json();
    const envelope = previewRecord(responseBody);

    if (envelope["success"] !== true) {
      throw new Error("Production provider envelope failed");
    }

    return envelope["result"];
  });

/** A bundle is upload data only: no shell, package hooks, builds, or inherited CI/app secrets. */
export const runProductionWrangler = (credentials: ProductionCredentials, args: string[]) =>
  Effect.tryPromise({
    try: () =>
      executeProductionFile(
        process.execPath,
        [nodePath.resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
        {
          cwd: "/tmp",
          timeout: wranglerTimeoutMs,
          maxBuffer: maximumWranglerOutputBytes,
          encoding: "utf8",
          env: {
            PATH: "/usr/local/bin:/usr/bin:/bin",
            HOME: "/tmp/production-wrangler-home",
            CI: "true",
            WRANGLER_SEND_METRICS: "false",
            CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
            CLOUDFLARE_API_TOKEN: credentials.token,
          },
        },
      ),
    catch: () => new Error("Production Wrangler operation failed; output suppressed"),
  });

/** Existing Workers require the production owner marker; names alone never authorize overwrite. */
export const verifyProductionWorkerOwner = (
  credentials: ProductionCredentials,
  name: string,
  prefix: string,
  allowCreate: boolean,
) =>
  Effect.gen(function* () {
    const settings = yield* productionRequest(credentials, `/workers/scripts/${name}/settings`);

    if (settings === null) {
      if (!allowCreate) {
        throw new Error("Production Worker missing; explicit bootstrap consent required");
      }

      return;
    }

    const bindings = previewRecord(settings)["bindings"];

    if (
      !Array.isArray(bindings) ||
      !bindings.some((binding: unknown) => {
        const value = previewRecord(binding);

        return (
          value["name"] === "OWNER_ID" && value["type"] === "plain_text" && value["text"] === prefix
        );
      })
    ) {
      throw new Error("Production Worker owner marker mismatch");
    }
  });

/** Post-deploy readback must identify the selected release and keep private Workers unexposed. */
export const verifyProductionWorkerRelease = (
  credentials: ProductionCredentials,
  name: string,
  sha: string,
  publicWorker: boolean,
) =>
  Effect.gen(function* () {
    const bindings = previewRecord(
      yield* productionRequest(credentials, `/workers/scripts/${name}/settings`),
    )["bindings"];

    if (
      !Array.isArray(bindings) ||
      !bindings.some((binding: unknown) => {
        const value = previewRecord(binding);
        return value["name"] === "RELEASE_SHA" && value["text"] === sha;
      })
    ) {
      throw new Error("Production release readback mismatch");
    }

    const subdomain = previewRecord(
      yield* productionRequest(credentials, `/workers/scripts/${name}/subdomain`),
    );

    if (subdomain["enabled"] !== publicWorker || subdomain["previews_enabled"] === true) {
      throw new Error("Production ingress readback mismatch");
    }

    return previewString(name);
  });

/** An existing Workflow must point at the already owned production Worker. */
export const verifyProductionWorkflowOwner = (
  credentials: ProductionCredentials,
  prefix: string,
  ownerMarker: string,
) =>
  Effect.gen(function* () {
    const workflow = yield* productionRequest(credentials, `/workflows/${prefix}-workflow`);

    if (workflow !== null) {
      const current = previewRecord(workflow);

      if (
        current["script_name"] !== `${prefix}-workflows` ||
        current["class_name"] !== "DemoWorkflow"
      ) {
        throw new Error("Production workflow ownership mismatch");
      }

      yield* verifyProductionWorkerOwner(credentials, `${prefix}-workflows`, ownerMarker, false);
    }
  });
