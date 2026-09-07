import { Config, Effect } from "effect";
import { z } from "zod";
import { ProductionAppSchema, parseProductionValue } from "../production/production_model.ts";
import { buildProductionArtifacts } from "./production_artifacts.ts";

const ProductionBuildSchema = z.strictObject({
  app: ProductionAppSchema,
  sha: z.string().regex(/^[a-f\d]{40}$/u),
  repositoryId: z.string().regex(/^\d+$/u),
});

const buildConfiguration = Config.all({
  app: Config.string("DEPLOYMENT_APP"),
  sha: Config.string("REVISION"),
  repositoryId: Config.string("REPOSITORY_ID"),
});

try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const configuration = yield* buildConfiguration;
      const revision = parseProductionValue(ProductionBuildSchema, configuration);
      yield* buildProductionArtifacts(".", "production-artifact", revision);
    }),
  );
} catch {
  process.stderr.write("Production build failed; output suppressed\n");
  process.exitCode = 1;
}
