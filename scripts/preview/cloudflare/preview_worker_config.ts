import { planPreviewDomains } from "../domains/preview_domain_ownership.ts";
import { Effect } from "effect";
import { loadDeploymentRuntime } from "../../shared/deployment_doppler.ts";
import nodePath from "node:path";
import { previewResource, previewString } from "../preview_model.ts";
import type { PreviewManifest } from "../preview_model.ts";
import type { PreviewCredentials } from "./preview_cloudflare.ts";

/** Public origins derive only from owned resource names and an independently verified zone suffix. */
export function previewPublicUrls(manifest: PreviewManifest, credentials: PreviewCredentials) {
  planPreviewDomains(manifest, credentials.domains);

  return {
    api: `https://${previewResource(manifest, "api").name}.${credentials.domains.suffix}`,
    frontend: `https://${previewResource(manifest, "frontend").name}.${credentials.domains.suffix}`,
  };
}

function configurePreviewWorkflowBindings(
  config: Record<string, unknown>,
  manifest: PreviewManifest,
  credentials: PreviewCredentials,
): void {
  config["workflows"] = [
    {
      binding: "WORKFLOW",
      name: previewResource(manifest, "workflow").name,
      class_name: "DemoWorkflow",
    },
  ];

  const bindings = [{ name: "COORDINATOR", class_name: "JobCoordinator" }];
  const classes = ["JobCoordinator"];

  if (manifest.sandbox) {
    bindings.push({ name: "SANDBOX", class_name: "Sandbox" });
    classes.push("Sandbox");

    config["containers"] = [
      {
        name: `${previewResource(manifest, "workflows").name}-sandbox`,
        class_name: "Sandbox",
        image: previewString(credentials.sandboxImage),
        instance_type: "lite",
        max_instances: 1,
      },
    ];
  }

  config["durable_objects"] = { bindings };
  config["migrations"] = [{ tag: "preview-v1", new_sqlite_classes: classes }];
}

/** Binding names are the public application contract; no PR Wrangler config is read. */
export function renderPreviewWorkerConfig(
  manifest: PreviewManifest,
  credentials: PreviewCredentials,
  app: "api" | "workflows" | "frontend",
  artifactRoot: string,
): Record<string, unknown> {
  const urls = previewPublicUrls(manifest, credentials);

  const dataBindings = {
    hyperdrive: [
      { binding: "HYPERDRIVE", id: previewString(previewResource(manifest, "hyperdrive").id) },
    ],
    kv_namespaces: [{ binding: "CACHE", id: previewString(previewResource(manifest, "cache").id) }],
    r2_buckets: [{ binding: "OBJECTS", bucket_name: previewResource(manifest, "objects").name }],
  };

  const config: Record<string, unknown> = {
    name: previewResource(manifest, app).name,
    account_id: manifest.owner.accountId,
    main: nodePath.resolve(artifactRoot, `${app}.mjs`),
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    no_bundle: true,
    workers_dev: false,
    preview_urls: false,
    vars: {
      ENVIRONMENT: "preview",
      PULL_REQUEST_NUMBER: String(manifest.owner.pr),
      COMMIT_SHA: manifest.head,
    },
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: true, head_sampling_rate: 0.1 },
    },
  };

  if (app === "frontend") {
    config["assets"] = {
      directory: nodePath.resolve(artifactRoot, "assets"),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true,
    };
  } else {
    Object.assign(config, dataBindings);

    const queues: Record<string, unknown> = {
      producers: [{ binding: "JOBS", queue: previewResource(manifest, "jobs").name }],
    };

    if (app === "workflows") {
      queues["consumers"] = [
        { queue: previewResource(manifest, "jobs").name, max_batch_size: 10, max_retries: 3 },
      ];
    }

    config["queues"] = queues;

    if (app === "api") {
      config["services"] = [
        { binding: "WORKFLOWS", service: previewResource(manifest, "workflows").name },
      ];
    }

    if (app === "api") {
      config["vars"] = {
        ENVIRONMENT: "preview",
        API_URL: urls.api,
        FRONTEND_ORIGINS: urls.frontend,
        EMAIL_DELIVERY: "capture",
      };

      config["workflows"] = [
        {
          binding: "WORKFLOW",
          name: previewResource(manifest, "workflow").name,
          class_name: "DemoWorkflow",
          script_name: previewResource(manifest, "workflows").name,
        },
      ];

      config["durable_objects"] = {
        bindings: [
          {
            name: "COORDINATOR",
            class_name: "JobCoordinator",
            script_name: previewResource(manifest, "workflows").name,
          },
        ],
      };
    }
  }

  if (app === "workflows") {
    configurePreviewWorkflowBindings(config, manifest, credentials);
  }

  return config;
}

/** Validate every app baseline before the preview controller creates any resources. */
export const loadPreviewRuntimeBaselines = () =>
  Effect.gen(function* () {
    return {
      workflows: yield* loadDeploymentRuntime("workflows", "preview"),
      api: yield* loadDeploymentRuntime("api", "preview"),
      frontend: yield* loadDeploymentRuntime("frontend", "preview"),
    };
  });
