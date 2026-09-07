import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Effect, ManagedRuntime, Schedule } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createClient } from 'redis';
import { Workflow, type BackgroundJob } from '@factory/platform';
import { portablePlatformLayer, consumeRedisJobs, ensureRedisQueueGroup, reclaimRedisJobs } from '@factory/platform/portable';
import { runNoteJob } from '@factory/platform/demo';
import { readPortableConfiguration } from '../../api/src/portable-configuration.js';

const configuration = readPortableConfiguration();
const program = Effect.gen(function* () {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(portablePlatformLayer(configuration))),
    acquired => Effect.promise(() => acquired.dispose()),
  );
  const connection = yield* Effect.acquireRelease(
    Effect.tryPromise(() => NativeConnection.connect({ address: configuration.temporalAddress })).pipe(
      Effect.tapError(error => Effect.logWarning('Temporal startup connection failed; retrying', error)),
      Effect.retry(Schedule.spaced('2 seconds')),
      Effect.interruptible,
    ),
    acquired => Effect.promise(() => acquired.close()),
  );
  const worker = yield* Effect.tryPromise(() => Worker.create({
    connection, namespace: configuration.temporalNamespace ?? 'default', taskQueue: configuration.taskQueue,
    workflowsPath: fileURLToPath(new URL('temporal-workflow.ts', import.meta.url)),
    shutdownGraceTime: '10 seconds', shutdownForceTime: '20 seconds',
    activities: { processNote: async (job: BackgroundJob) => { await runtime.runPromise(runNoteJob(job)); } },
  })).pipe(Effect.retry({ times: 10, schedule: Schedule.spaced('2 seconds') }));
  const redis = yield* Effect.acquireRelease(
    Effect.sync(() => createClient({ RESP: 2, url: configuration.redisUrl })),
    acquired => Effect.sync(() => { if (acquired.isOpen) acquired.destroy(); }),
  );
  redis.on('error', () => { /* Command failures propagate to the supervised Effect loop. */ });
  yield* Effect.tryPromise(() => redis.connect());
  const stream = `${configuration.namespace}:jobs`;
  const group = 'workflows';
  const consumer = `worker-${randomUUID()}`;
  yield* ensureRedisQueueGroup(redis, stream, group);
  const startWorkflow = async (job: BackgroundJob) => { await runtime.runPromise(Workflow.use(workflow => workflow.start(job))); };
  // Scan one pending page per pass; successful pages advance the cursor.
  let reclaimCursor = '0-0';
  const pollJobs = Effect.gen(function* () {
    reclaimCursor = yield* reclaimRedisJobs(redis, stream, group, consumer, 30_000, reclaimCursor, startWorkflow);
    yield* consumeRedisJobs(redis, stream, group, consumer, startWorkflow);
  }).pipe(
    // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Effect.catch handles typed effects, not JavaScript promises.
    Effect.catch(error => Effect.logError('Workflow queue poll failed; unacknowledged jobs remain pending', error)),
  );
  const runningWorker = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const completion = worker.run();
      // Observe failures immediately; the supervising Effect below still propagates the original rejection.
      const settled = Promise.allSettled([completion]);
      return { completion, settled };
    }),
    acquired => Effect.promise(async () => {
      if (worker.getState() === 'RUNNING') worker.shutdown();
      await acquired.settled;
    }),
  );
  const runWorker = Effect.tryPromise(() => runningWorker.completion);
  yield* Effect.all([
    runWorker,
    Effect.forever(pollJobs.pipe(Effect.andThen(Effect.sleep('500 millis')))),
  ], { concurrency: 'unbounded' });
});
NodeRuntime.runMain(Effect.scoped(program));
