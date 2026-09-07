import { Effect } from "effect";
import { loadDeploymentRuntime } from "./preview-doppler.ts";
import nodePath from "node:path";
import { previewResource, previewString } from "./preview-model.ts";
import type { PreviewManifest } from "./preview-model.ts";
import type { PreviewCredentials } from "./preview-cloudflare.ts";

/** Binding names are the public application contract; no PR Wrangler config is read. */
export function renderPreviewWorkerConfig(
  manifest: PreviewManifest, credentials: PreviewCredentials, app: "api" | "workflows" | "frontend", artifactRoot: string,
): Record<string, unknown> {
  const dataBindings = {
    d1_databases: [{ binding: "DATABASE", database_name: previewResource(manifest, "database").name,
      database_id: previewString(previewResource(manifest, "database").id) }],
    kv_namespaces: [{ binding: "CACHE", id: previewString(previewResource(manifest, "cache").id) }],
    r2_buckets: [{ binding: "OBJECTS", bucket_name: previewResource(manifest, "objects").name }],
  };
  const config: Record<string, unknown> = {
    name: previewResource(manifest, app).name, account_id: manifest.owner.accountId,
    main: nodePath.resolve(artifactRoot, `${app}.mjs`), compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"],
    no_bundle: true, workers_dev: app === "frontend", preview_urls: false,
    vars: { ENVIRONMENT: "preview", PREVIEW_PR: String(manifest.owner.pr), PREVIEW_HEAD: manifest.head },
    observability: { enabled: true, logs: { enabled: true, invocation_logs: true, head_sampling_rate: 0.1 } },
  };
  if (app === "frontend") {
    config["assets"] = { directory: nodePath.resolve(artifactRoot, "assets"), binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: true };
    config["services"] = [{ binding: "API", service: previewResource(manifest, "api").name }];
  } else {
    Object.assign(config, dataBindings);
    config["queues"] = { producers: [{ binding: "JOBS", queue: previewResource(manifest, "jobs").name }],
      ...(app === "workflows" ? { consumers: [{ queue: previewResource(manifest, "jobs").name, max_batch_size: 10, max_retries: 3 }] } : {}) };
    if (app === "api") config["services"] = [{ binding: "WORKFLOWS", service: previewResource(manifest, "workflows").name }];
    if (app === "api") {
      config["workflows"] = [{ binding: "WORKFLOW", name: previewResource(manifest, "workflow").name,
        class_name: "DemoWorkflow", script_name: previewResource(manifest, "workflows").name }];
      config["durable_objects"] = { bindings: [{ name: "COORDINATOR", class_name: "JobCoordinator",
        script_name: previewResource(manifest, "workflows").name }] };
    }
    if (manifest.hyperdrive) config["hyperdrive"] = [{ binding: "HYPERDRIVE", id: previewString(previewResource(manifest, "hyperdrive").id) }];
  }
  if (app === "workflows") {
    config["workflows"] = [{ binding: "WORKFLOW", name: previewResource(manifest, "workflow").name, class_name: "DemoWorkflow" }];
    const bindings = [{ name: "COORDINATOR", class_name: "JobCoordinator" }];
    const classes = ["JobCoordinator"];
    if (manifest.sandbox) {
      bindings.push({ name: "SANDBOX", class_name: "Sandbox" });
      classes.push("Sandbox");
      config["containers"] = [{ name: `${previewResource(manifest, "workflows").name}-sandbox`, class_name: "Sandbox",
        image: previewString(credentials.sandboxImage), instance_type: "lite", max_instances: 1 }];
    }
    config["durable_objects"] = { bindings };
    config["migrations"] = [{ tag: "preview-v1", new_sqlite_classes: classes }];
  }
  return config;
}

/** Validate every app baseline before the preview controller creates any resources. */
export const loadPreviewRuntimeBaselines = () => Effect.gen(function* () {
  return {
    workflows: yield* loadDeploymentRuntime("workflows", "preview"),
    api: yield* loadDeploymentRuntime("api", "preview"),
    frontend: yield* loadDeploymentRuntime("frontend", "preview"),
  };
});
