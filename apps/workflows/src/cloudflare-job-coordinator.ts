import { DurableObject } from "cloudflare:workers";
import { DurableObjectLeaseStorage } from "@factory/platform/cloudflare";

/** Persistent per-key lease host; RPC callers are limited to bound Workers. */
export class JobCoordinator extends DurableObject {
  private readonly leases = new DurableObjectLeaseStorage(this.ctx);
  acquire(token: string, ttlMs: number): Promise<boolean> {
    return this.leases.acquire(token, ttlMs);
  }
  release(token: string): Promise<boolean> {
    return this.leases.release(token);
  }
}
