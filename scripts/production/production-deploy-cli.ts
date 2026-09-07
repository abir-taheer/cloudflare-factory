import { Effect } from "effect";
import { deployProductionApplication } from "./production-deploy.ts";

try {
  await Effect.runPromise(deployProductionApplication());
} catch {
  process.stderr.write("Production deploy failed; output suppressed\n");
  process.exitCode = 1;
}
