import { Layer } from "effect";
import type  { DurableObjectState } from "@cloudflare/workers-types";
import { Coordinator } from "../capability-services.js";
import { capabilityOperation, validateLeaseInput } from "./capability-operation.js";

/** Minimal RPC namespace compatible with a deployed lease Durable Object. */
export interface CoordinatorNamespace {
  getByName(name: string): {
    acquire(token: string, ttlMs: number): Promise<boolean>;
    release(token: string): Promise<boolean>;
  };
}
/** Durable Object adapter uses one named object per lease key. */
export const durableObjectCoordinatorLayer = (namespace: CoordinatorNamespace) => Layer.succeed(Coordinator, Coordinator.of({
  acquire: (key, token, ttlMs) => capabilityOperation("coordinator", "acquire", async () => {
    validateLeaseInput(token, ttlMs);
    return namespace.getByName(key).acquire(token, ttlMs);
  }),
  release: (key, token) => capabilityOperation("coordinator", "release", async () => {
    if (!token) throw new Error("Coordinator release requires an ownership token");
    return namespace.getByName(key).release(token);
  }),
}));
/** Delegate RPC methods from the host's DurableObject subclass to this persistent lease implementation. */
export class DurableObjectLeaseStorage {
  constructor(private readonly state: Pick<DurableObjectState, "storage">) {}
  async acquire(token: string, ttlMs: number): Promise<boolean> {
    validateLeaseInput(token, ttlMs);
    return this.state.storage.transaction(async (storage) => {
      const lease = await storage.get<{ token: string; expiresAt: number }>("lease");
      if (lease && lease.expiresAt > Date.now()) return false;
      await storage.put("lease", { token, expiresAt: Date.now() + ttlMs });
      return true;
    });
  }
  async release(token: string): Promise<boolean> {
    if (!token) throw new Error("Coordinator release requires an ownership token");
    return this.state.storage.transaction(async (storage) => {
      const lease = await storage.get<{ token: string; expiresAt: number }>("lease");
      if (!lease || lease.token !== token || lease.expiresAt <= Date.now()) return false;
      return storage.delete("lease");
    });
  }
}
