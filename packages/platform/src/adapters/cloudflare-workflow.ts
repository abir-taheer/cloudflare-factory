import { Layer } from "effect";
import type { Workflow as CloudflareWorkflow } from "@cloudflare/workers-types";
import { type BackgroundJob, Workflow } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";

/** Cloudflare workflow binding points to an externally deployed workflow entrypoint. */
export const cloudflareWorkflowLayer = (binding: CloudflareWorkflow<BackgroundJob>) =>
  Layer.succeed(
    Workflow,
    Workflow.of({
      start: (job) =>
        capabilityOperation("workflow", "start", async () => {
          const instance = await binding.create({ id: job.id, params: job });
          return instance.id;
        }),
    }),
  );
