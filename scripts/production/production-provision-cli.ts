import { Effect } from "effect";
import { provisionProductionDatabase } from "./production-provision.ts";

try {
  await Effect.runPromise(provisionProductionDatabase());
} catch {
  process.stderr.write("Production provision failed; output suppressed\n");
  process.exitCode = 1;
}
