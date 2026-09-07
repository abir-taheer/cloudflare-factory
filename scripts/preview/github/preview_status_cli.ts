import { Effect } from "effect";
import {
  PreviewStatusStateSchema,
  previewStatusConfiguration,
  publishPreviewStatus,
} from "./preview_status.ts";

try {
  const state = PreviewStatusStateSchema.parse(process.argv[2]);
  const configuration = await Effect.runPromise(previewStatusConfiguration);

  await Effect.runPromise(publishPreviewStatus(configuration, state));
} catch {
  process.stderr.write("Preview status update failed; details suppressed\n");
  process.exitCode = 1;
}
