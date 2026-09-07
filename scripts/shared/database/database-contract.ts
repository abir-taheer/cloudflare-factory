import { lstat, readFile, writeFile } from "node:fs/promises";
import { previewIo } from "../../preview/preview-model.ts";
import { DatabaseHandoffSchema } from "./database-schema.ts";
import type { DatabaseHandoff } from "./database-schema.ts";

const databasePathMinimumLength = 2;
const maximumTcpPort = 65_535;
const privatePermissionModulus = 0o100;
const handoffLimitBytes = 16_384;

/** Direct PostgreSQL connections must carry TLS and cannot override connection routing through query parameters. */
export function validateDatabaseDirectUrl(directUrl: string, hostname: string): void {
  const url = new URL(directUrl);
  const allowedQuery = new Set(["sslmode", "channel_binding"]);

  const isUnsafeDatabaseConnection =
    url.protocol !== "postgresql:" ||
    url.hostname !== hostname ||
    url.hostname.includes("-pooler") ||
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.pathname.length < databasePathMinimumLength ||
    url.hash.length > 0 ||
    !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") ||
    /[\r\n]/u.test(directUrl) ||
    [...url.searchParams.keys()].some((key) => !allowedQuery.has(key)) ||
    (url.port !== "" && (Number(url.port) < 1 || Number(url.port) > maximumTcpPort));

  if (isUnsafeDatabaseConnection) {
    throw new Error("Database direct TLS connection required");
  }
}

/** Reject pooled URLs, identity drift, missing TLS and ownership from another deployment. */
export function parseDatabaseHandoff(
  value: unknown,
  expected: Omit<DatabaseHandoff, "version" | "directUrl">,
): DatabaseHandoff {
  const result = DatabaseHandoffSchema.safeParse(value);

  if (!result.success) {
    throw new Error("Database handoff schema invalid");
  }

  const handoff = result.data;

  for (const key of ["accountId", "repositoryId", "environment", "pr"] as const) {
    if (handoff.owner[key] !== expected.owner[key]) {
      throw new Error("Database handoff owner mismatch");
    }
  }

  for (const key of [
    "provider",
    "projectId",
    "parentBranchId",
    "intentId",
    "branchId",
    "endpointId",
    "hostname",
  ] as const) {
    if (handoff.identity[key] !== expected.identity[key]) {
      throw new Error("Database handoff identity drift");
    }
  }

  const { identity } = handoff;

  if (
    handoff.name !== expected.name ||
    identity.branchId === null ||
    identity.endpointId === null ||
    identity.hostname === null ||
    identity.branchId === identity.parentBranchId
  ) {
    throw new Error("Database handoff branch invalid");
  }

  if (
    (handoff.owner.environment === "preview" &&
      (handoff.owner.pr === null || handoff.owner.pr < 1)) ||
    (handoff.owner.environment === "prod" && handoff.owner.pr !== null)
  ) {
    throw new Error("Database handoff scope invalid");
  }

  validateDatabaseDirectUrl(handoff.directUrl, identity.hostname);
  return handoff;
}

/** Read only a private regular file; credentials never enter the artifact directory. */
export const readDatabaseHandoff = (
  path: string,
  expected: Omit<DatabaseHandoff, "version" | "directUrl">,
) =>
  previewIo("Database handoff validation failed", async () => {
    const stat = await lstat(path);

    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode % privatePermissionModulus !== 0 ||
      stat.size > handoffLimitBytes
    ) {
      throw new Error("Database handoff file unsafe");
    }

    const text = await readFile(path, "utf8");
    const value: unknown = JSON.parse(text);
    return parseDatabaseHandoff(value, expected);
  });

/** The caller supplies a private runner-temp directory; no connection is printed or exported as an output. */
export const writeDatabaseHandoff = (path: string, handoff: DatabaseHandoff) =>
  previewIo("Database private handoff write failed", async () => {
    parseDatabaseHandoff(handoff, handoff);

    if (process.env["GITHUB_ACTIONS"] === "true") {
      const mask = (value: string) =>
        value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

      process.stdout.write(`::add-mask::${mask(handoff.directUrl)}\n`);

      process.stdout.write(
        `::add-mask::${mask(decodeURIComponent(new URL(handoff.directUrl).password))}\n`,
      );
    }

    await writeFile(path, JSON.stringify(handoff), { mode: 0o600, flag: "wx" });
  });
