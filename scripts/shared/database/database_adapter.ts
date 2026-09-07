import type { Effect } from "effect";
import type { PreviewFailure } from "../../preview/preview_model.ts";
import type { DatabaseHandoff, DatabaseIdentity } from "./database_schema.ts";

/** The caller persists this target before invoking a provider-specific composite action. */
export type DatabaseTarget = Pick<DatabaseHandoff, "owner" | "name" | "identity">;

/** PlanetScale or another provider implements the same provision/remove boundary. */
export interface PreviewDatabaseAdapter {
  provision: (
    target: DatabaseTarget,
    save: (identity: DatabaseIdentity) => Effect.Effect<void, PreviewFailure>,
  ) => Effect.Effect<DatabaseHandoff, PreviewFailure>;
  remove: (target: DatabaseTarget) => Effect.Effect<void, PreviewFailure>;
}
