import { ProductionEmailSchema } from "../shared/deployment-doppler.ts";
import nodePath from "node:path";
import { z } from "zod";
import { previewRecord } from "../preview/preview-model.ts";

/** Validate deployment data without retaining secret-bearing Zod diagnostics. */
export function parseProductionValue<Value>(schema: z.ZodType<Value>, value: unknown): Value {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error("Production validation failed");
  }

  return result.data;
}

/** Trusted deployment identity supplies generated names and owner markers. */
const ProductionWorkerOwnerSchema = z.strictObject({
  accountId: z.string(),
  repositoryId: z.string(),
  prefix: z.string(),
  sha: z.string(),
});

/** Worker owner fields are inferred from their serializable schema. */
export type ProductionWorkerOwner = z.infer<typeof ProductionWorkerOwnerSchema>;

/** Fixed app selections never become shell commands or arbitrary entrypoint paths. */
export const ProductionAppSchema = z.enum(["workflows", "api", "frontend", "all"]);

/** The stack order supports first bootstrap; individual selections change one Worker only. */
export const productionApps = (
  selection: z.infer<typeof ProductionAppSchema>,
): ("workflows" | "api" | "frontend")[] => {
  if (selection === "all") {
    return ["workflows", "api", "frontend"];
  }

  return [selection];
};

const ProductionResourceSchema = z.strictObject({ name: z.string(), id: z.string() });

const ProductionInventorySchema = z.strictObject({
  cache: ProductionResourceSchema,
  objects: ProductionResourceSchema,
  jobs: ProductionResourceSchema,
});

/** Explicit production data inventory, separate from all preview state and ownership. */
export type ProductionInventory = z.infer<typeof ProductionInventorySchema>;

/** Deployment configuration chooses the namespace; no resource names or IDs are checked in. */
export const productionPrefix = (prefix: string) => {
  if (!/^[a-z][a-z0-9-]{2,39}$/u.test(prefix)) {
    throw new Error("Production resource prefix invalid");
  }

  return prefix;
};

/** Pre-provisioned resources require exact trusted names and IDs; unknown entries are rejected. */
export function parseProductionInventory(value: unknown, prefix: string): ProductionInventory {
  const resources = parseProductionValue(ProductionInventorySchema, value);

  for (const [suffix, resource] of Object.entries(resources)) {
    if (resource.name !== `${prefix}-${suffix}` || !/^[a-zA-Z\d_-]{1,128}$/u.test(resource.id)) {
      throw new Error("Production data ownership mismatch");
    }
  }

  if (resources.objects.id !== resources.objects.name) {
    throw new Error("Production bucket identity mismatch");
  }

  return resources;
}

/** Controller-generated configuration cannot execute app build hooks or inherit preview resources. */
export function renderProductionWorkerConfig(
  owner: ProductionWorkerOwner,
  resources: ProductionInventory,
  app: "api" | "workflows" | "frontend",
  artifactRoot: string,
  hyperdriveId: string,
  runtime: Record<string, string> = {},
) {
  const config: Record<string, unknown> = {
    name: `${owner.prefix}-${app}`,
    account_id: owner.accountId,
    main: nodePath.resolve(artifactRoot, `${app}.mjs`),
    no_bundle: true,
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    vars: {
      ENVIRONMENT: "prod",
      OWNER_ID: `${owner.accountId}:${owner.repositoryId}:prod:${owner.prefix}`,
      RELEASE_SHA: owner.sha,
    },
  };

  if (app === "frontend") {
    config["assets"] = {
      directory: nodePath.resolve(artifactRoot, "assets"),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true,
    };

    return config;
  }

  if (app === "api") {
    const email = parseProductionValue(ProductionEmailSchema, runtime);

    config["send_email"] = [{ name: "EMAIL", allowed_sender_addresses: [email.EMAIL_FROM] }];

    config["vars"] = {
      ...previewRecord(config["vars"]),
      API_URL: runtime["API_URL"],
      FRONTEND_ORIGINS: runtime["FRONTEND_ORIGINS"],
      ...email,
    };
  }

  config["hyperdrive"] = [{ binding: "HYPERDRIVE", id: hyperdriveId }];
  config["kv_namespaces"] = [{ binding: "CACHE", id: resources.cache.id }];
  config["r2_buckets"] = [{ binding: "OBJECTS", bucket_name: resources.objects.name }];

  const queueConsumers: Record<string, unknown> = {};
  const workflowHost: Record<string, string> = {};

  if (app === "workflows") {
    queueConsumers["consumers"] = [
      { queue: resources.jobs.name, max_batch_size: 10, max_retries: 3 },
    ];
  }

  if (app === "api") {
    workflowHost["script_name"] = `${owner.prefix}-workflows`;
  }

  config["queues"] = {
    producers: [{ binding: "JOBS", queue: resources.jobs.name }],
    ...queueConsumers,
  };

  config["workflows"] = [
    {
      binding: "WORKFLOW",
      name: `${owner.prefix}-workflow`,
      class_name: "DemoWorkflow",
      ...workflowHost,
    },
  ];

  config["durable_objects"] = {
    bindings: [
      {
        name: "COORDINATOR",
        class_name: "JobCoordinator",
        ...workflowHost,
      },
    ],
  };

  if (app === "workflows") {
    config["migrations"] = [{ tag: "prod-v1", new_sqlite_classes: ["JobCoordinator"] }];
  }

  return config;
}
