import { Effect } from "effect";
import { provisionProductionDatabase } from "./database/production_provision.ts";

try {
  await Effect.runPromise(provisionProductionDatabase());
} catch {
  process.stderr.write("Production provision failed; output suppressed\n");
  process.exitCode = 1;
}
