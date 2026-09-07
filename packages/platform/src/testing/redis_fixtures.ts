import type { RedisClientType } from "redis";
import { capabilityOperation } from "../adapters/capability_operation.js";

type RedisTestCleanupClient = Pick<RedisClientType, "keys" | "del" | "destroy" | "isOpen">;

/** Remove only the unique test namespace and always close the client if deletion fails. */
export const clearRedisTestNamespace = (client: RedisTestCleanupClient, prefix: string) =>
  capabilityOperation("testRedis", "cleanup", async () => {
    if (!client.isOpen) {
      return;
    }

    try {
      const keys = await client.keys(`${prefix}*`);

      if (keys.length > 0) {
        await client.del(keys);
      }
    } finally {
      client.destroy();
    }
  });
