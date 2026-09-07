import { readDatabaseHandoff as readProductionDatabase } from "../shared/database/database-contract.ts";
import { migrateProductionDatabase } from "./production-migrate.ts";
import { productionStateStore } from "./production-state.ts";
import { type loadProductionContext, verifyProductionRevision } from "./production-context.ts";
import { Config, Effect } from "effect";
import { z } from "zod";
import { type ProductionInventory, parseProductionValue } from "./production-model.ts";
import { previewRecord } from "../preview/preview-model.ts";
import type { DatabaseHandoff } from "../shared/database/database-schema.ts";
import { type ProductionCredentials, productionRequest } from "./production-control.ts";

type ProductionDatabaseContext = Effect.Success<ReturnType<typeof loadProductionContext>>;

const originConnectionLimit = 5;
const hyperdrivePageLimit = 100;

/** Retained connections must preserve fresh reads, verified TLS and the bounded origin pool. */
const verifyProductionHyperdrivePolicy = (configuration: Record<string, unknown>) => {
  if (
    previewRecord(configuration["caching"])["disabled"] !== true ||
    previewRecord(configuration["mtls"])["sslmode"] !== "verify-full" ||
    configuration["origin_connection_limit"] !== originConnectionLimit
  ) {
    throw new Error("Production Hyperdrive security policy drift");
  }
};

/** Bind only the composite action's migrated production database; unexpected origins are never adopted. */
export const prepareProductionHyperdrive = (
  credentials: ProductionCredentials,
  prefix: string,
  database: DatabaseHandoff,
  expectedId: string | undefined,
  allowCreate: boolean,
) =>
  Effect.gen(function* () {
    const name = `${prefix}-hyperdrive`;
    const url = new URL(database.directUrl);

    const databaseOrigin = {
      scheme: "postgresql",
      host: url.hostname,
      port: Number(url.port || "5432"),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };

    if (expectedId !== undefined) {
      if (!/^[a-f\d]{32}$/u.test(expectedId)) {
        throw new Error("Production Hyperdrive ID invalid");
      }

      const current = previewRecord(
        yield* productionRequest(credentials, `/hyperdrive/configs/${expectedId}`),
      );

      verifyProductionHyperdrivePolicy(current);

      const origin = previewRecord(current["origin"]);

      if (
        current["name"] !== name ||
        origin["host"] !== databaseOrigin.host ||
        origin["database"] !== databaseOrigin.database ||
        origin["user"] !== databaseOrigin.user ||
        origin["port"] !== databaseOrigin.port ||
        origin["scheme"] !== "postgresql"
      ) {
        throw new Error("Production Hyperdrive origin drift");
      }

      return expectedId;
    }

    if (!allowCreate) {
      throw new Error("Production Hyperdrive creation requires bootstrap consent");
    }

    let inventoryComplete = false;

    for (let page = 1; page <= hyperdrivePageLimit; page++) {
      const rows = yield* productionRequest(
        credentials,
        `/hyperdrive/configs?per_page=hyperdrivePageLimit&page=${page}`,
      );

      if (!Array.isArray(rows)) {
        throw new TypeError("Production Hyperdrive inventory unavailable");
      }

      if (rows.some((row: unknown) => previewRecord(row)["name"] === name)) {
        throw new Error("Production Hyperdrive exists without registered ID");
      }

      if (rows.length < hyperdrivePageLimit) {
        inventoryComplete = true;
        break;
      }
    }

    if (!inventoryComplete) {
      throw new Error("Production Hyperdrive inventory incomplete");
    }

    const result = previewRecord(
      yield* productionRequest(credentials, "/hyperdrive/configs", "POST", {
        name,
        origin: databaseOrigin,
        caching: { disabled: true },
        mtls: { sslmode: "verify-full" },
        origin_connection_limit: originConnectionLimit,
      }),
    );

    const HyperdriveIdSchema = z.string().regex(/^[a-f\d]{32}$/u);
    const id = parseProductionValue(HyperdriveIdSchema, result["id"]);

    const readback = previewRecord(
      yield* productionRequest(credentials, `/hyperdrive/configs/${id}`),
    );

    verifyProductionHyperdrivePolicy(readback);

    if (readback["name"] !== name) {
      throw new Error("Production Hyperdrive create readback failed");
    }

    return id;
  });

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
    yield* migrateProductionDatabase(database.directUrl);

    const hyperdriveId = yield* prepareProductionHyperdrive(
      credentials,
      prefix,
      database,
      state.hyperdriveId ?? undefined,
      dispatch.ALLOW_CREATE === "true",
    );

    yield* stateStore.save(state.identity, hyperdriveId);

    return hyperdriveId;
  });
