import { Effect } from "effect";
import { deployProductionApplication } from "./production_deploy.ts";

try {
  await Effect.runPromise(deployProductionApplication());
} catch {
  process.stderr.write("Production deploy failed; output suppressed\n");
  process.exitCode = 1;
}
