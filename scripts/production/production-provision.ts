import { Config, Effect } from "effect";
import { writeDatabaseHandoff } from "../shared/database/database-contract.ts";
import { loadNeonDatabaseCredentials } from "../shared/database/neon-api.ts";
import {
  createNeonDatabaseAdapter,
  createNeonDatabaseIdentity,
} from "../shared/database/neon-adapter.ts";
import { loadProductionContext, verifyProductionRevision } from "./production-context.ts";
import { productionStateStore } from "./production-state.ts";

/** Provider-specific composite runner; persistent production identity has no cleanup/reset path. */
export const provisionProductionDatabase = () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { dispatch, config, prefix, owner } = yield* loadProductionContext();
      const credentials = yield* loadNeonDatabaseCredentials("prod");
      const state = yield* productionStateStore(config, owner, prefix);
      const prior = yield* state.load();

      if (prior === null && dispatch.ALLOW_CREATE !== "true") {
        throw new Error("Production database requires explicit bootstrap consent");
      }

      const identity = prior?.identity ?? createNeonDatabaseIdentity(credentials);

      if (prior === null) {
        yield* state.save(identity, null);
      }

      yield* verifyProductionRevision(dispatch);

      const handoff = yield* createNeonDatabaseAdapter(credentials).provision(
        { owner, name: `${prefix}-postgres`, identity },
        (next) => state.save(next, prior?.hyperdriveId ?? null),
      );

      yield* writeDatabaseHandoff(yield* Config.string("DATABASE_OUTPUT_FILE"), handoff);
    }),
  );
