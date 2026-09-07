import { Layer } from "effect";
import type  { R2Bucket } from "@cloudflare/workers-types";
import { ObjectStore } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";
/** R2 object store; reads buffer the complete object and are intended for small artifacts. */
export const r2ObjectStoreLayer = (bucket: R2Bucket) => Layer.succeed(ObjectStore, ObjectStore.of({
  put: (key, body) => capabilityOperation("objectStore", "put", async () => { await bucket.put(key, body); }),
  get: (key) => capabilityOperation("objectStore", "get", async () => {
    const object = await bucket.get(key);
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }),
  delete: (key) => capabilityOperation("objectStore", "delete", () => bucket.delete(key)),
}));
