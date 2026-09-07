import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { buildWorker } from "./build-worker.ts";
import { Effect } from "effect";
import { z } from "zod";
import {
  type ProductionCredentials,
  executeProductionFile,
  runProductionWrangler,
} from "../production/production-control.ts";
import { previewIo, previewRecord } from "../preview/preview-model.ts";
import {
  ProductionAppSchema,
  parseProductionValue,
  productionApps,
} from "../production/production-model.ts";

const maximumArtifactBytes = 26_214_400;
const maximumBuildOutputBytes = 1_048_576;
const maximumArtifactEntries = 2000;

/** Artifact provenance is checked against protected job inputs, never used as authority. */
const ProductionRevisionSchema = z.strictObject({
  sha: z.string(),
  repositoryId: z.string(),
  app: ProductionAppSchema,
});

/** Artifact metadata uses the same schema for build inputs and provenance. */
export type ProductionRevision = z.infer<typeof ProductionRevisionSchema>;

const inspectArtifactTree = async (root: string) => {
  let count = 0;
  let bytes = 0;

  const inspect = async (path: string): Promise<void> => {
    const stat = await lstat(path);

    count += 1;
    bytes += stat.size;

    if (count > maximumArtifactEntries || bytes > maximumArtifactBytes || stat.isSymbolicLink()) {
      throw new Error("Production artifact limit or link");
    }

    if (stat.isDirectory()) {
      for (const name of await readdir(path)) {
        await inspect(nodePath.join(path, name));
      }
    } else if (!stat.isFile()) {
      throw new Error("Production artifact special file");
    }
  };

  await inspect(root);
};

/** Credential-free builds select only requested app entrypoints and static assets. */
export const buildProductionArtifacts = (
  root: string,
  output: string,
  revision: ProductionRevision,
) =>
  previewIo("Production artifact build failed", async () => {
    await mkdir(output, { recursive: true });

    for (const app of productionApps(revision.app)) {
      await buildWorker(
        nodePath.resolve(root, `apps/${app}/src/cloudflare-${app}.ts`),
        nodePath.resolve(output, `${app}.mjs`),
      );

      if (app === "frontend") {
        await executeProductionFile("npm", ["run", "build", "--workspace", "@factory/frontend"], {
          cwd: root,
          timeout: 120_000,
          maxBuffer: maximumBuildOutputBytes,
        });

        const assets = nodePath.resolve(root, "apps/frontend/dist");

        await inspectArtifactTree(assets);

        await cp(assets, nodePath.resolve(output, "assets"), {
          recursive: true,
          dereference: false,
        });
      }
    }

    await writeFile(nodePath.resolve(output, "provenance.json"), JSON.stringify(revision));
  });

/** Only finite, regular, selected-app artifacts from this exact protected revision are accepted. */
export const validateProductionArtifacts = (root: string, revision: ProductionRevision) =>
  previewIo("Production artifact provenance failed", async () => {
    await inspectArtifactTree(root);

    const expected = [
      "provenance.json",
      ...productionApps(revision.app).map((app) => `${app}.mjs`),
    ];

    const includesFrontend = productionApps(revision.app).includes("frontend");

    if (includesFrontend) {
      expected.push("assets");
    }

    const names = await readdir(root);

    if (names.length !== expected.length || names.some((name) => !expected.includes(name))) {
      throw new Error("Production artifact set invalid");
    }

    for (const name of expected) {
      const stat = await lstat(nodePath.join(root, name));

      if (name === "assets" ? !stat.isDirectory() : !stat.isFile()) {
        throw new Error("Production artifact shape invalid");
      }
    }

    const text = await readFile(nodePath.join(root, "provenance.json"), "utf8");
    const provenance = parseProductionValue(ProductionRevisionSchema, JSON.parse(text));

    if (
      provenance.sha !== revision.sha ||
      provenance.repositoryId !== revision.repositoryId ||
      provenance.app !== revision.app
    ) {
      throw new Error("Production artifact revision mismatch");
    }
  });

/** Upload only the already-built selected artifact with ephemeral controller-owned configuration. */
export const deployProductionArtifact = (
  credentials: ProductionCredentials,
  rendered: Record<string, unknown>,
  secrets: Record<string, string>,
  app: string,
  runtime: Record<string, string>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        previewIo("Production temporary directory failed", () =>
          mkdtemp("/tmp/production-deploy-"),
        ),
        (path) =>
          previewIo("Production temporary cleanup failed", () =>
            rm(path, { recursive: true, force: true }),
          ).pipe(Effect.orDie),
      );

      const configPath = nodePath.join(directory, "worker.json");
      const secretsPath = nodePath.join(directory, "secrets.json");

      yield* previewIo("Production Worker configuration failed", async () => {
        if (app === "frontend") {
          const sourceAssets = nodePath.resolve("production-artifact/assets");
          const assets = nodePath.join(directory, "assets");

          await cp(sourceAssets, assets, { recursive: true, dereference: false });

          await writeFile(
            nodePath.join(assets, "runtime-config.json"),
            JSON.stringify({ API_URL: runtime["API_URL"], ENVIRONMENT: "prod" }),
            { mode: 0o600 },
          );

          rendered["assets"] = { ...previewRecord(rendered["assets"]), directory: assets };
        }

        await writeFile(configPath, JSON.stringify(rendered), { mode: 0o600 });
        await writeFile(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
      });

      yield* runProductionWrangler(credentials, [
        "deploy",
        "--config",
        configPath,
        "--no-bundle",
        ...(app === "api" ? ["--secrets-file", secretsPath] : []),
      ]);
    }),
  );
