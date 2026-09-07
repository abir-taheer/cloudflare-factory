import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ConfigProvider, Effect, ManagedRuntime, Schedule } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createClient } from "redis";
import { type BackgroundJob, Workflow } from "@factory/platform";
import {
  consumeRedisJobs,
  ensureRedisQueueGroup,
  portablePlatformLayer,
  reclaimRedisJobs,
} from "@factory/platform/portable";
import { runNoteJob } from "@factory/platform/demo";
import { parsePortableConfiguration } from "@factory/platform/configuration";

const queueReclaimIdleMs = 30_000;
const configuration = Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnv()));

// tsx development compiles the source workflow; packaged Node loads the build-time bundle.
function resolveWorkflowDefinition() {
  const isSourceEntrypoint = import.meta.url.endsWith(".ts");

  if (isSourceEntrypoint) {
    return { workflowsPath: fileURLToPath(new URL("temporal-workflow.ts", import.meta.url)) };
  }

  return {
    workflowBundle: {
      codePath: fileURLToPath(new URL("temporal-workflow-bundle.js", import.meta.url)),
    },
  };
}

const program = Effect.gen(function* () {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(portablePlatformLayer(configuration))),
    (acquired) => Effect.promise(() => acquired.dispose()),
  );

  const connection = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      NativeConnection.connect({ address: configuration.temporalAddress }),
    ).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Temporal startup connection failed; retrying").pipe(
          Effect.annotateLogs("failure.category", "temporal_connect"),
        ),
      ),
      Effect.retry(Schedule.spaced("2 seconds")),
      Effect.interruptible,
    ),
    (acquired) => Effect.promise(() => acquired.close()),
  );

  const worker = yield* Effect.tryPromise(() =>
    Worker.create({
      connection,
      namespace: configuration.temporalNamespace ?? "default",
      taskQueue: configuration.taskQueue,
      ...resolveWorkflowDefinition(),
      shutdownGraceTime: "10 seconds",
      shutdownForceTime: "20 seconds",
      activities: {
        processNote: async (job: BackgroundJob) => {
          await runtime.runPromise(runNoteJob(job));
        },
      },
    }),
  ).pipe(Effect.retry({ times: 10, schedule: Schedule.spaced("2 seconds") }));

  const redis = yield* Effect.acquireRelease(
    Effect.sync(() => createClient({ RESP: 2, url: configuration.redisUrl })),
    (acquired) =>
      Effect.sync(() => {
        if (acquired.isOpen) {
          acquired.destroy();
        }
      }),
  );

  redis.on("error", () => {
    /* Command failures propagate to the supervised Effect loop. */
  });

  yield* Effect.tryPromise(() => redis.connect());

  const stream = `${configuration.namespace}:jobs`;
  const group = "workflows";
  const consumer = `worker-${randomUUID()}`;
  yield* ensureRedisQueueGroup(redis, stream, group);

  const startWorkflow = async (job: BackgroundJob) => {
    await runtime.runPromise(Workflow.pipe(Effect.flatMap((workflow) => workflow.start(job))));
  };

  // Scan one pending page per pass; successful pages advance the cursor.
  let reclaimCursor = "0-0";

  const pollJobs = Effect.gen(function* () {
    reclaimCursor = yield* reclaimRedisJobs(
      redis,
      stream,
      group,
      consumer,
      queueReclaimIdleMs,
      reclaimCursor,
      startWorkflow,
    );

    yield* consumeRedisJobs(redis, stream, group, consumer, startWorkflow);
  }).pipe(
    Effect.catch(() =>
      Effect.logError("Workflow queue poll failed; unacknowledged jobs remain pending").pipe(
        Effect.annotateLogs("failure.category", "queue_poll"),
      ),
    ),
    Effect.withSpan("workflows.queue.poll"),
  );

  const runningWorker = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const completion = worker.run();
      // Observe failures immediately; the supervising Effect below still propagates the original rejection.
      const settled = Promise.allSettled([completion]);
      return { completion, settled };
    }),
    (acquired) =>
      Effect.promise(async () => {
        if (worker.getState() === "RUNNING") {
          worker.shutdown();
        }

        await acquired.settled;
      }),
  );

  const runWorker = Effect.tryPromise(() => runningWorker.completion);

  yield* Effect.all(
    [runWorker, Effect.forever(pollJobs.pipe(Effect.andThen(Effect.sleep("500 millis"))))],
    { concurrency: "unbounded" },
  );
}).pipe(Effect.withSpan("workflows.host.run"));

NodeRuntime.runMain(Effect.scoped(program));
