import { Effect } from "effect";
import { z } from "zod";
import { migratePreviewArtifact } from "./preview_artifact_migrate.ts";

const nodeArgumentOffset = 2;

const PreviewMigrationInputSchema = z.strictObject({
  databaseUrl: z.url({ protocol: /^postgres(?:ql)?$/u }),
  arguments: z.tuple([z.string().min(1)]),
});

// The trusted child receives only the owned preview database credential, never control-plane secrets.
try {
  const input = PreviewMigrationInputSchema.safeParse({
    databaseUrl: process.env["DATABASE_URL"],
    arguments: process.argv.slice(nodeArgumentOffset),
  });

  if (!input.success) {
    throw new Error("Preview migration input rejected");
  }

  await Effect.runPromise(migratePreviewArtifact(input.data.databaseUrl, input.data.arguments[0]));
} catch {
  process.stderr.write("PostgreSQL migration failed; connection details suppressed\n");
  process.exitCode = 1;
}
