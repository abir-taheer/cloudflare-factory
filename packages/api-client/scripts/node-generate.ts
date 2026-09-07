/* eslint-disable import/no-nodejs-modules -- Node-only OpenAPI artifact generation command. */
/* eslint-disable node/no-top-level-await -- ESM-only build command. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { createApiApplication } from "../../../apps/api/src/http/api-application.js";
import { apiDocumentConfiguration } from "../../../apps/api/src/http/api-openapi.js";

import { PublicOpenApiSchema } from "./public-openapi.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const document = PublicOpenApiSchema.parse(
  createApiApplication().getOpenAPI31Document(apiDocumentConfiguration),
);

const documentFormatOptions = await resolveConfig(path.join(packageRoot, "openapi.json"));

const documentText = await format(JSON.stringify(document), {
  ...documentFormatOptions,
  parser: "json",
});

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "factory-openapi-"));

try {
  const inputPath = path.join(temporaryDirectory, "openapi.json");
  await writeFile(inputPath, documentText);

  const syntax = await openapiTS(pathToFileURL(inputPath));
  const formatOptions = await resolveConfig(path.join(packageRoot, "src/api-paths.d.ts"));
  const typeText = await format(astToString(syntax), { ...formatOptions, parser: "typescript" });

  const artifacts = [
    ["openapi.json", documentText],
    ["src/api-paths.d.ts", typeText],
  ] as const;

  await Promise.all(
    artifacts.map(async ([relativePath, content]) => {
      const outputPath = path.join(packageRoot, relativePath);

      if (process.argv.includes("--check")) {
        const recorded = await readFile(outputPath, "utf8");

        if (recorded !== content) {
          throw new Error(
            "Generated API client drift: run npm run generate --workspace @factory/api-client",
          );
        }
      } else {
        await writeFile(outputPath, content);
      }
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
