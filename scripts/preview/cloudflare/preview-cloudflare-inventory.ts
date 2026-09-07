import { Effect } from "effect";
import { PreviewFailure, previewIo, previewRecord } from "../preview-model.ts";
import type { PreviewCloudflare, PreviewCredentials } from "./preview-cloudflare.ts";

const cloudflareTimeoutMs = 30_000;
const httpNotFound = 404;
const httpNoContent = 204;
const inventoryPageLimit = 10_000;
const inventoryPageSize = 100;

function createCloudflareRawRequest(credentials: PreviewCredentials) {
  return (path: string, method = "GET", body?: unknown) =>
    previewIo("Preview Cloudflare request failed", async () => {
      if (!path.startsWith("/") || path.includes("..")) {
        throw new Error("Invalid API path");
      }

      const requestBody: Pick<RequestInit, "body"> = {};

      if (body !== undefined) {
        requestBody.body = JSON.stringify(body);
      }

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
          },
          ...requestBody,
          signal: AbortSignal.timeout(cloudflareTimeoutMs),
          redirect: "error",
        },
      );

      if (response.status === httpNotFound) {
        return null;
      }

      if (!response.ok) {
        throw new Error("Provider request failed");
      }

      if (response.status === httpNoContent) {
        return { success: true, result: null };
      }

      const text = await response.text();

      if (text.length === 0 && method === "DELETE") {
        return { success: true, result: null };
      }

      const envelope = previewRecord(JSON.parse(text));

      if (envelope["success"] !== true) {
        throw new Error("Provider envelope failed");
      }

      return envelope;
    });
}

function readCloudflareInventoryRows(result: unknown) {
  if (Array.isArray(result)) {
    return { rows: result, resultObject: undefined };
  }

  const resultObject = previewRecord(result);
  return { rows: resultObject["buckets"], resultObject };
}

/** Provider inventories preserve ownership evidence across every cursor and page. */
export function createPreviewCloudflareInventory(
  credentials: PreviewCredentials,
): Pick<PreviewCloudflare, "request" | "list"> {
  const raw = createCloudflareRawRequest(credentials);

  const request: PreviewCloudflare["request"] = (path, method, body) =>
    raw(path, method, body).pipe(
      Effect.map((envelope) => (envelope === null ? null : envelope["result"])),
    );

  const list: PreviewCloudflare["list"] = (path) =>
    Effect.gen(function* () {
      const entries: Record<string, unknown>[] = [];
      let cursor = "";

      for (let page = 1; page <= inventoryPageLimit; page++) {
        const query = new URLSearchParams({
          per_page: "100",
          ...(cursor === "" ? { page: String(page) } : { cursor }),
        });

        const envelope = yield* raw(`${path}?${query}`);

        if (envelope === null) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview inventory unavailable" }),
          );
        }

        const result = envelope["result"];
        const { rows, resultObject } = readCloudflareInventoryRows(result);

        if (!Array.isArray(rows)) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview inventory shape invalid" }),
          );
        }

        entries.push(...rows.map((value: unknown) => previewRecord(value)));

        const info =
          envelope["result_info"] === undefined ? {} : previewRecord(envelope["result_info"]);

        const next = info["cursor"] ?? resultObject?.["cursor"];

        if (path === "/r2/buckets" && (typeof next !== "string" || next.length === 0)) {
          return entries;
        }

        if (typeof next === "string" && next.length > 0) {
          if (next === cursor) {
            return yield* Effect.fail(
              new PreviewFailure({ operation: "Preview inventory cursor stalled" }),
            );
          }

          cursor = next;
        } else if (typeof info["total_pages"] === "number") {
          if (page >= info["total_pages"]) {
            return entries;
          }
        } else if (rows.length < inventoryPageSize || path === "/workers/scripts") {
          return entries;
        }
      }

      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview inventory pagination exceeded" }),
      );
    });

  return { request, list };
}
