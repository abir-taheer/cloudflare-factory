import { readDatabaseHandoff as readProductionDatabase } from "../../shared/database/database_contract.ts";
import { migrateProductionDatabase } from "./production_migrate.ts";
import { productionStateStore } from "../production_state.ts";
import { type loadProductionContext, verifyProductionRevision } from "../production_context.ts";
import { prepareProductionHyperdrive } from "./production_hyperdrive.ts";
import { Config, Effect } from "effect";
import type { ProductionInventory } from "../production_model.ts";
import { previewRecord } from "../../preview/preview_model.ts";
import { productionRequest } from "../production_control.ts";

type ProductionDatabaseContext = Effect.Success<ReturnType<typeof loadProductionContext>>;

/** Prepare the registered production database before uploading any selected backend. */
export const prepareProductionDeploymentDatabase = (
  context: ProductionDatabaseContext,
  resources: ProductionInventory,
) =>
  Effect.gen(function* () {
    const { dispatch, config, credentials, prefix, owner } = context;

    for (const [resource, path, key] of [
      [resources.cache, `/storage/kv/namespaces/${resources.cache.id}`, "title"],
      [resources.objects, `/r2/buckets/${resources.objects.id}`, "name"],
      [resources.jobs, `/queues/${resources.jobs.id}`, "queue_name"],
    ] as const) {
      const live = previewRecord(yield* productionRequest(credentials, path));

      if (live[key] !== resource.name) {
        throw new Error("Production resource inventory drift");
      }
    }

    const stateStore = yield* productionStateStore(config, owner, prefix);
    const state = yield* stateStore.load();

    if (state === null) {
      throw new Error("Production database composite action has not completed");
    }

    const database = yield* readProductionDatabase(yield* Config.string("DATABASE_OUTPUT_FILE"), {
      owner,
      name: `${prefix}-postgres`,
      identity: state.identity,
    });

    yield* verifyProductionRevision(dispatch);
    process.stdout.write("Production resource inventory and database handoff verified.\n");
    yield* migrateProductionDatabase(database.directUrl);
    process.stdout.write("Production database migrations applied; preparing Hyperdrive.\n");

    const hyperdriveId = yield* prepareProductionHyperdrive({
      credentials,
      prefix,
      database,
      expectedId: state.hyperdriveId,
      allowCreate: dispatch.ALLOW_CREATE === "true",
      save: (id) => stateStore.save(state.identity, id),
    });

    process.stdout.write("Production Hyperdrive identity and connection policy verified.\n");

    return hyperdriveId;
  });
