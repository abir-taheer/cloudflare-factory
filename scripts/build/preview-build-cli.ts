import { Effect } from "effect";
import { buildPreviewArtifacts } from "./preview-build.ts";

try {
  await Effect.runPromise(
    buildPreviewArtifacts(process.argv[2] ?? ".", process.argv[3] ?? "/tmp/preview-build"),
  );
} catch {
  process.stderr.write("Preview artifact build failed\n");
  process.exitCode = 1;
}
