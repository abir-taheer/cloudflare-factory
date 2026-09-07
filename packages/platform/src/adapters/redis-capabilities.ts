import { Layer, Schema } from "effect";
import type  { RedisClientType } from "redis";
import { Coordinator, KeyValue, Queue, type BackgroundJob } from "../capability-services.js";
import { capabilityOperation, validateCacheTtl, validateLeaseInput } from "./capability-operation.js";

/** Connected caller-owned Redis client; register an error listener at the composition root. */
export type PlatformRedisClient = Pick<RedisClientType, "get" | "set" | "del" | "eval" | "xAdd" | "xReadGroup" | "xAck" | "xGroupCreate" | "xAutoClaim">;
const decodeQueueJob = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, noteId: Schema.String }));
const decodeQueueBatches = Schema.decodeUnknownSync(Schema.NullOr(Schema.Array(Schema.Struct({
  messages: Schema.Array(Schema.Struct({ id: Schema.String, message: Schema.Struct({ job: Schema.String }) })),
}))));
/** Redis cache namespace should be unique to the deployment. */
export const redisKeyValueLayer = (client: PlatformRedisClient, prefix: string) => Layer.succeed(KeyValue, KeyValue.of({
  get: (key) => capabilityOperation("keyValue", "get", () => client.get(prefix + key)),
  put: (key, value, ttlSeconds) => capabilityOperation("keyValue", "put", async () => {
    validateCacheTtl(ttlSeconds);
    await client.set(prefix + key, value, ttlSeconds === undefined ? {} : { expiration: { type: "EX", value: ttlSeconds } });
  }),
  delete: (key) => capabilityOperation("keyValue", "delete", async () => { await client.del(prefix + key); }),
}));
/** Redis Streams queue persists jobs; provision a consumer group before consuming. */
export const redisQueueLayer = (client: PlatformRedisClient, stream: string) => Layer.succeed(Queue, Queue.of({
  enqueue: (job) => capabilityOperation("queue", "enqueue", async () => {
    await client.xAdd(stream, "*", { job: JSON.stringify(job) });
  }),
}));
/** Acknowledge only after successful processing; failure leaves the message pending for reclaim. */
export const consumeRedisJobs = (client: PlatformRedisClient, stream: string, group: string, consumer: string, process: (job: BackgroundJob) => Promise<void>) =>
  capabilityOperation("queue", "consume", async () => {
    const batches = decodeQueueBatches(await client.xReadGroup(group, consumer, { key: stream, id: ">" }, { COUNT: 10 }));
    for (const batch of batches ?? []) {for (const message of batch.messages) {
      const job = decodeQueueJob(JSON.parse(message.message.job));
      await process(job);
      await client.xAck(stream, group, message.id);
    }}
  });
/** Redis lease uses SET NX PX and atomic compare-and-delete to reject stale owners. */
export const redisCoordinatorLayer = (client: PlatformRedisClient, prefix: string) => Layer.succeed(Coordinator, Coordinator.of({
  acquire: (key, token, ttlMs) => capabilityOperation("coordinator", "acquire", async () => {
    validateLeaseInput(token, ttlMs);
    return await client.set(prefix + key, token, { condition: "NX", expiration: { type: "PX", value: ttlMs } }) === "OK";
  }),
  release: (key, token) => capabilityOperation("coordinator", "release", async () => {
    if (!token) throw new Error("Coordinator release requires an ownership token");
    return await client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", { keys: [prefix + key], arguments: [token] }) === 1;
  }),
}));

/** Create a Redis stream group from its beginning; only an existing group is tolerated. */
export const ensureRedisQueueGroup = (client: PlatformRedisClient, stream: string, group: string) =>
  capabilityOperation("queue", "createGroup", async () => {
    try { await client.xGroupCreate(stream, group, "0", { MKSTREAM: true }); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("BUSYGROUP ")) throw error; }
  });

/** Reclaim idle pending jobs after worker failure; pass returned cursor until it is 0-0. */
// oxlint-disable-next-line max-params -- Keep the published consumer helper signature compatible with the host integration.
export const reclaimRedisJobs = (client: PlatformRedisClient, stream: string, group: string, consumer: string, minIdleMs: number, cursor: string, process: (job: BackgroundJob) => Promise<void>) =>
  capabilityOperation("queue", "reclaim", async () => {
    if (!Number.isSafeInteger(minIdleMs) || minIdleMs <= 0) throw new Error("Redis queue reclaim requires positive minimum idle milliseconds");
    const batch = await client.xAutoClaim(stream, group, consumer, minIdleMs, cursor, { COUNT: 10 });
    for (const message of batch.messages) {
      if (message !== null) {
        const job = decodeQueueJob(JSON.parse(message.message['job'] ?? "null"));
        await process(job);
        await client.xAck(stream, group, message.id);
      }
    }
    return batch.nextId;
  });
