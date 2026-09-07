import { readdir } from "node:fs/promises";
import path from "node:path";

const kebabName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const snakeName = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const maximumDirectAuthoredFiles = 20;
const maximumModuleFiles = 14;

const standardFiles = new Set([
  "AGENTS.md",
  "README.md",
  "Dockerfile",
  "LICENSE",
  "LICENSE.md",
  "package-lock.json",
]);

const rootToolFiles = new Set([
  ".git",
  ".dockerignore",
  ".gitignore",
  ".gitattributes",
  ".gitleaks.toml",
  ".npmrc",
  ".oxlintrc.json",
  ".prettierrc.json",
  ".prettierignore",
  ".editorconfig",
  ".env",
  ".env.example",
]);

const rootToolDirectories = new Set([".github", ".agents", ".codex", ".junie"]);

const githubToolPaths = new Set([
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE",
  ".github/PULL_REQUEST_TEMPLATE",
  ".github/PULL_REQUEST_TEMPLATE.md",
]);

const localOutputDirectories = new Set([
  ".git",
  ".idea",
  ".local",
  ".wrangler",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  "preview-artifact",
  "production-artifact",
]);

function isGeneratedOutputDirectory(relativePath) {
  const segments = relativePath.split("/");
  const basename = segments.at(-1);

  if (basename === "node_modules") {
    return true;
  }

  const workspaceOutput = /^(?:apps|packages)\/[^/]+\/[^/]+$/u.test(relativePath);
  return (segments.length === 1 || workspaceOutput) && localOutputDirectories.has(basename);
}

function hasConventionalPathName(relativePath, directory) {
  const basename = path.posix.basename(relativePath);
  const parent = path.posix.dirname(relativePath);

  if (directory) {
    if (
      relativePath.startsWith("apps/api/src/routes/") &&
      /^\[[a-z][a-z0-9]*(?:-[a-z0-9]+)*\]$/u.test(basename)
    ) {
      return true;
    }

    if (parent === "." && rootToolDirectories.has(basename)) {
      return true;
    }

    if (githubToolPaths.has(relativePath) && basename.endsWith("_TEMPLATE")) {
      return true;
    }

    if (
      parent === "packages/platform/migrations/drizzle" &&
      /^\d{14}_[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(basename)
    ) {
      return true;
    }

    return kebabName.test(basename);
  }

  if (standardFiles.has(basename) || githubToolPaths.has(relativePath)) {
    return true;
  }

  if (parent === "." && rootToolFiles.has(basename)) {
    return true;
  }

  const workspaceToolFile =
    /^(?:apps|packages)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(parent) &&
    [".env", ".env.example", ".gitignore", ".npmrc", ".dockerignore"].includes(basename);

  if (workspaceToolFile) {
    return true;
  }

  return basename.split(".").every((segment) => snakeName.test(segment));
}

/** Check authored path names and direct file counts, including untracked paths, without following symlinks. */
export async function findPathConventionViolations(root) {
  const violations = [];

  const visit = async (relativeDirectory) => {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    const directFileCount = entries.filter((entry) => entry.isFile()).length;

    const workspaceRoot =
      relativeDirectory === "" || /^(?:apps|packages)\/[^/]+$/u.test(relativeDirectory);

    const maximumFiles = workspaceRoot ? maximumDirectAuthoredFiles : maximumModuleFiles;

    if (directFileCount > maximumFiles) {
      violations.push(
        `${relativeDirectory || "."}: directory contains ${directFileCount} direct authored files; maximum is ${maximumFiles}`,
      );
    }

    const directories = [];

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const directory = entry.isDirectory();

      if (directory && isGeneratedOutputDirectory(relativePath)) {
        continue;
      }

      if (!hasConventionalPathName(relativePath, directory)) {
        violations.push(
          `${relativePath}: ${directory ? "directory name must use kebab-case" : "file name must use snake_case"}`,
        );
      }

      if (directory) {
        directories.push(relativePath);
      }
    }

    await Promise.all(directories.map((directory) => visit(directory)));
  };

  await visit("");
  return violations.toSorted((left, right) => left.localeCompare(right));
}

if (import.meta.main) {
  const violations = await findPathConventionViolations(process.cwd());

  for (const violation of violations) {
    process.stderr.write(`${violation}\n`);
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  } else {
    process.stdout.write("File and directory conventions passed.\n");
  }
}
