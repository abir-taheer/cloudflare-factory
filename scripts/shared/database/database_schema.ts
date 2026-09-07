import { z } from "zod";

const DatabaseIdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const NullableDatabaseIdentifierSchema = DatabaseIdentifierSchema.nullable();

/** Non-secret identity survives retries; a persisted nonce prevents foreign branch adoption. */
export const DatabaseIdentitySchema = z.strictObject({
  provider: DatabaseIdentifierSchema,
  projectId: DatabaseIdentifierSchema,
  parentBranchId: DatabaseIdentifierSchema,
  intentId: DatabaseIdentifierSchema,
  branchId: NullableDatabaseIdentifierSchema,
  endpointId: NullableDatabaseIdentifierSchema,
  hostname: z.string().nullable(),
});

/** Persist only this type in ownership manifests, never the direct connection URL. */
export type DatabaseIdentity = z.infer<typeof DatabaseIdentitySchema>;

/** Production and preview adapters share the contract while retaining distinct ownership. */
export const DatabaseOwnerSchema = z.strictObject({
  accountId: z.string().regex(/^[a-f0-9]{32}$/u),
  repositoryId: z.string().regex(/^\d+$/u),
  environment: z.enum(["preview", "prod"]),
  pr: z.number().refine(Number.isSafeInteger).nullable(),
});

/** Database handoffs are private files produced by trusted composite actions, never PR artifacts. */
export const DatabaseHandoffSchema = z.strictObject({
  version: z.literal(1),
  owner: DatabaseOwnerSchema,
  name: DatabaseIdentifierSchema,
  identity: DatabaseIdentitySchema,
  directUrl: z.string(),
});

/** Vendor-neutral input consumed by Hyperdrive and trusted PostgreSQL migrations. */
export type DatabaseHandoff = z.infer<typeof DatabaseHandoffSchema>;
