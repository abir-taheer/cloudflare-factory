import { createPreviewCloudflareInventory } from "./preview-cloudflare-inventory.ts";
import { PreviewCredentialsSchema } from "../preview-configuration.ts";
import { access } from "node:fs/promises";
import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord, previewString } from "../preview-model.ts";
import type { PreviewResource } from "../preview-model.ts";
import { loadDeploymentDoppler } from "../../shared/deployment-doppler.ts";
import { runPreviewWrangler } from "./preview-command.ts";
import type { PreviewCredentials } from "../preview-configuration.ts";

const cloudflareTimeoutMs = 30_000;

export type { PreviewCredentials } from "../preview-configuration.ts";

/** A replaceable control-plane adapter; no application code receives this capability. */
export interface PreviewCloudflare {
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Effect.Effect<unknown, PreviewFailure>;
  list: (path: string) => Effect.Effect<Record<string, unknown>[], PreviewFailure>;
  lookupResource: (resource: PreviewResource) => Effect.Effect<string | null, PreviewFailure>;
  create: (resource: PreviewResource) => Effect.Effect<string, PreviewFailure>;
  remove: (resource: PreviewResource, id: string) => Effect.Effect<void, PreviewFailure>;
}

function parsePreviewOptionalCapabilities(config: Record<string, unknown>) {
  const optional = (key: string) =>
    config[key] === undefined ? undefined : previewString(config[key]);

  const flag = (key: string) => {
    if (config[key] === undefined || config[key] === "false") {
      return false;
    }

    if (config[key] === "true") {
      return true;
    }

    throw new Error("Boolean configuration invalid");
  };

  const sandbox = flag("SANDBOX_ENABLED");
  const sandboxImage = optional("SANDBOX_IMAGE");

  if (
    sandbox &&
    (config["ALLOW_PAID_SANDBOX"] !== "true" ||
      sandboxImage === undefined ||
      !/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$/u.test(
        sandboxImage,
      ))
  ) {
    throw new Error("Sandbox requires paid consent and trusted immutable image");
  }

  return { sandbox, sandboxImage };
}

/** Fetch a config-scoped Doppler token without printing or exporting the downloaded config. */
export const loadPreviewCredentials = (local = false) =>
  Effect.gen(function* () {
    yield* previewIo("Preview protected environment invalid", async () => {
      if (local) {
        await access("/.dockerenv");
      }

      if (
        !local &&
        (process.env["GITHUB_ACTIONS"] !== "true" ||
          process.env["DEPLOYMENT_ENVIRONMENT"] !== "cloudflare-preview")
      ) {
        throw new Error("Protected environment required");
      }
    });

    const config = yield* loadDeploymentDoppler("DEPLOY", "preview");

    return yield* Effect.try({
      try: () => {
        const result = PreviewCredentialsSchema.safeParse(config);

        if (!result.success) {
          throw new Error("Preview controller configuration invalid");
        }

        const validated = result.data;
        const accountId = validated.accountId;

        if (
          accountId !== process.env["CLOUDFLARE_ACCOUNT_ID"] ||
          validated.domains.zoneId !== process.env["CLOUDFLARE_ZONE_ID"] ||
          validated.domains.zoneName !== process.env["CLOUDFLARE_ZONE_NAME"] ||
          validated.domains.suffix !== process.env["DOMAIN_SUFFIX"] ||
          previewString(config["ACCOUNT_NAME"]) !==
            previewString(process.env["CLOUDFLARE_ACCOUNT_NAME"])
        ) {
          throw new Error("Account mismatch");
        }

        process.env["RESOURCE_PREFIX"] = previewString(config["RESOURCE_PREFIX"]);

        parsePreviewOptionalCapabilities(config);
        return validated;
      },
      catch: () => new PreviewFailure({ operation: "Preview protected configuration invalid" }),
    });
  });

const resourcePaths = {
  kv: "/storage/kv/namespaces",
  r2: "/r2/buckets",
  queue: "/queues",
  worker: "/workers/scripts",
  workflow: "/workflows",
  hyperdrive: "/hyperdrive/configs",
  database: "",
  do: "/workers/durable_objects/namespaces",
  container: "/containers/applications",
};

/** REST calls redact provider response bodies and paginate every supported inventory. */
export function createPreviewCloudflare(credentials: PreviewCredentials): PreviewCloudflare {
  const { request, list } = createPreviewCloudflareInventory(credentials);

  const find: PreviewCloudflare["lookupResource"] = (resource) =>
    Effect.gen(function* () {
      if (resource.kind === "database") {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview database requires external adapter" }),
        );
      }

      const rawRows: unknown = yield* Effect.gen(function* () {
        if (resource.kind === "container") {
          const inventory: unknown = JSON.parse(
            yield* runPreviewWrangler(credentials, ["containers", "list", "--json"]),
          );

          return inventory;
        }

        return yield* list(resourcePaths[resource.kind]);
      });

      if (!Array.isArray(rawRows)) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview container inventory invalid" }),
        );
      }

      const rows = rawRows.map((value: unknown) => previewRecord(value));

      const matches = rows.filter((row) => {
        if (resource.kind === "do") {
          return (
            row["script"] ===
              resource.name.replace(/-(?:coordinator|sandbox-state)$/u, "-workflows") &&
            row["class"] === (resource.name.endsWith("-coordinator") ? "JobCoordinator" : "Sandbox")
          );
        }

        return (row["name"] ?? row["title"] ?? row["queue_name"] ?? row["id"]) === resource.name;
      });

      if (matches.length > 1) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview duplicate resource names" }),
        );
      }

      const match = matches[0];

      if (!match) {
        return null;
      }

      return previewString(match["uuid"] ?? match["queue_id"] ?? match["id"] ?? match["name"]);
    });

  const create: PreviewCloudflare["create"] = (resource) =>
    Effect.gen(function* () {
      let body: Record<string, string> = { name: resource.name };

      if (resource.kind === "kv") {
        body = { title: resource.name };
      }

      if (resource.kind === "queue") {
        body = { queue_name: resource.name };
      }

      const isDirectlyProvisionedResource = ["kv", "r2", "queue"].includes(resource.kind);

      if (!isDirectlyProvisionedResource) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview resource requires deployment adapter" }),
        );
      }

      const result = previewRecord(yield* request(resourcePaths[resource.kind], "POST", body));
      return previewString(result["uuid"] ?? result["queue_id"] ?? result["id"] ?? result["name"]);
    });

  const remove: PreviewCloudflare["remove"] = (resource, id) => {
    if (resource.kind === "container") {
      return runPreviewWrangler(credentials, ["containers", "delete", id]).pipe(Effect.asVoid);
    }

    const deletionId = resource.kind === "workflow" ? resource.name : id;
    const query = resource.kind === "worker" ? "?force=true" : "";

    return request(
      `${resourcePaths[resource.kind]}/${encodeURIComponent(deletionId)}${query}`,
      "DELETE",
    ).pipe(Effect.asVoid);
  };

  return { request, list, lookupResource: find, create, remove };
}

/** Identity readback occurs before any provisioning or deletion. */
export const verifyPreviewAccount = (credentials: PreviewCredentials) =>
  previewIo("Preview account identity verification failed", async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}`,
      {
        headers: { Authorization: `Bearer ${credentials.token}` },
        signal: AbortSignal.timeout(cloudflareTimeoutMs),
        redirect: "error",
      },
    );

    if (!response.ok) {
      throw new Error("Account unavailable");
    }

    const result: unknown = await response.json();
    const account = previewRecord(previewRecord(result)["result"]);

    if (
      account["id"] !== credentials.accountId ||
      account["name"] !== previewString(process.env["CLOUDFLARE_ACCOUNT_NAME"])
    ) {
      throw new Error("Account identity mismatch");
    }
  });
