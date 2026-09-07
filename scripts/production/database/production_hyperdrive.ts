import { Effect } from "effect";
import { z } from "zod";
import { parseProductionValue } from "../production_model.ts";
import { previewRecord } from "../../preview/preview_model.ts";
import type { PreviewFailure } from "../../preview/preview_model.ts";
import type { DatabaseHandoff } from "../../shared/database/database_schema.ts";
import { type ProductionCredentials, productionRequest } from "../production_control.ts";
import {
  hyperdriveConnectionPolicy,
  verifyHyperdriveConnectionPolicy,
} from "../../shared/database/hyperdrive_policy.ts";

const hyperdrivePageLimit = 100;

interface ProductionHyperdriveInput {
  credentials: ProductionCredentials;
  prefix: string;
  database: Pick<DatabaseHandoff, "directUrl">;
  expectedId: string | null;
  allowCreate: boolean;
  save: (id: string) => Effect.Effect<unknown, PreviewFailure>;
}

/** Bind only the composite action's migrated production database; unexpected origins are never adopted. */
export const prepareProductionHyperdrive = (input: ProductionHyperdriveInput) =>
  Effect.gen(function* () {
    const { credentials, prefix, database, expectedId, allowCreate, save } = input;
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

    const verifyReadback = (configuration: Record<string, unknown>, id: string) => {
      verifyHyperdriveConnectionPolicy(configuration);

      const origin = previewRecord(configuration["origin"]);

      if (
        configuration["name"] !== name ||
        origin["host"] !== databaseOrigin.host ||
        origin["database"] !== databaseOrigin.database ||
        origin["user"] !== databaseOrigin.user ||
        origin["port"] !== databaseOrigin.port ||
        origin["scheme"] !== "postgresql"
      ) {
        throw new Error("Production Hyperdrive origin drift");
      }

      if (configuration["id"] !== id) {
        throw new Error("Production Hyperdrive readback identity mismatch");
      }
    };

    if (expectedId !== null) {
      if (!/^[a-f\d]{32}$/u.test(expectedId)) {
        throw new Error("Production Hyperdrive ID invalid");
      }

      const current = previewRecord(
        yield* productionRequest(credentials, `/hyperdrive/configs/${expectedId}`),
      );

      verifyReadback(current, expectedId);

      return expectedId;
    }

    if (!allowCreate) {
      throw new Error("Production Hyperdrive creation requires bootstrap consent");
    }

    let inventoryComplete = false;

    for (let page = 1; page <= hyperdrivePageLimit; page++) {
      const rows = yield* productionRequest(
        credentials,
        `/hyperdrive/configs?per_page=${hyperdrivePageLimit}&page=${page}`,
      );

      if (!Array.isArray(rows)) {
        throw new TypeError("Production Hyperdrive inventory unavailable");
      }

      if (rows.some((row: unknown) => previewRecord(row)["name"] === name)) {
        throw new Error("Production Hyperdrive exists without registered ID");
      }

      if (rows.length === 0) {
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
        ...hyperdriveConnectionPolicy,
      }),
    );

    const HyperdriveIdSchema = z.string().regex(/^[a-f\d]{32}$/u);
    const id = parseProductionValue(HyperdriveIdSchema, result["id"]);
    yield* save(id);

    const readback = previewRecord(
      yield* productionRequest(credentials, `/hyperdrive/configs/${id}`),
    );

    verifyReadback(readback, id);

    return id;
  });
