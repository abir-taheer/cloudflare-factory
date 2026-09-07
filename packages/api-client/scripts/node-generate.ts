/* eslint-disable node/no-top-level-await -- This ESM-only Node generation entrypoint is never loaded with require. */
/* eslint-disable import/no-nodejs-modules -- This existing generator is a Node build entrypoint. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generate } from "orval";
import { createApiApplication } from "../../../apps/api/src/http/api-application.js";
import { apiDocumentConfiguration } from "../../../apps/api/src/http/api-openapi.js";

const jsonIndentation = 2;

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const document = createApiApplication().getOpenAPI31Document(apiDocumentConfiguration);
const documentText = `${JSON.stringify(document, null, jsonIndentation)}\n`;
const checking = process.argv.includes("--check");
let outputDirectory = `${packageRoot}src/generated`;

if (checking) {
  outputDirectory = await mkdtemp(`${packageRoot}src/.generated-check-`);
}

const inputDirectory = await mkdtemp(`${packageRoot}src/.openapi-input-`);

try {
  const inputPath = `${inputDirectory}/openapi.json`;

  await writeFile(inputPath, documentText);

  await generate(
    {
      input: { target: inputPath },
      output: {
        target: `${outputDirectory}/api.ts`,
        client: "react-query",
        httpClient: "fetch",
        mode: "single",
        override: {
          fetch: { includeHttpResponseReturnType: false },
          mutator: { name: "apiFetch", path: `${packageRoot}src/http.ts` },
          query: { signal: true },
        },
        tsconfig: `${packageRoot}tsconfig.json`,
      },
    },
    packageRoot,
    { throwOnError: true },
  );

  if (checking) {
    const [actual, expected, recordedDocument] = await Promise.all([
      readFile(`${outputDirectory}/api.ts`, "utf8"),
      readFile(`${packageRoot}src/generated/api.ts`, "utf8"),
      readFile(`${packageRoot}openapi.json`, "utf8"),
    ]);

    if (actual !== expected || documentText !== recordedDocument) {
      throw new Error(
        "Generated API client drift: run npm run generate --workspace @factory/api-client",
      );
    }
  } else {
    await writeFile(`${packageRoot}openapi.json`, documentText);
  }
} finally {
  await rm(inputDirectory, { recursive: true, force: true });

  if (checking) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}
