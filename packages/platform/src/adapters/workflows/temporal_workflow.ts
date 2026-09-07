import { Layer } from "effect";
import { type Client, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { Workflow } from "../../capability_services.js";
import { capabilityOperation } from "../capability_operation.js";

/** Temporal start uses durable job IDs; duplicate delivery is accepted only for a known existing execution. */
export const temporalWorkflowLayer = (client: Client, workflowType: string, taskQueue: string) =>
  Layer.succeed(
    Workflow,
    Workflow.of({
      start: (job) =>
        capabilityOperation("workflow", "start", async () => {
          try {
            const handle = await client.workflow.start(workflowType, {
              workflowId: job.id,
              workflowIdReusePolicy: "REJECT_DUPLICATE",
              taskQueue,
              args: [job],
            });

            return handle.workflowId;
          } catch (error) {
            if (error instanceof WorkflowExecutionAlreadyStartedError) {
              return job.id;
            }

            throw error;
          }
        }),
    }),
  );
