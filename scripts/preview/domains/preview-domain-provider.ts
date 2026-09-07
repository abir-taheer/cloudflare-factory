import { z } from "zod";
import { Effect } from "effect";
import { PreviewFailure, previewIo } from "../preview-model.ts";
import type { PreviewCredentials } from "../preview-configuration.ts";
import {
  CloudflareCertificatePackSchema,
  CloudflareDnsRecordSchema,
  CloudflareDomainSchema,
} from "./preview-domain-model.ts";
import type { PreviewDomainState } from "./preview-domain-model.ts";

const requestTimeoutMs = 30_000;
const maximumInventoryPages = 100;
const inventoryPageSize = 50;

const EnvelopeSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number().int().nonnegative().optional() }).optional(),
});

const DeletionEnvelopeSchema = EnvelopeSchema.partial({ result: true });

const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.literal("active"),
  account: z.object({ id: z.string() }),
});

function createDomainRequest(credentials: PreviewCredentials) {
  return (path: string, method = "GET", body?: unknown) =>
    previewIo("Preview domain provider request failed", async () => {
      const requestBody: Pick<RequestInit, "body"> = {};

      if (body !== undefined) {
        requestBody.body = JSON.stringify(body);
      }

      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
        },
        ...requestBody,
        signal: AbortSignal.timeout(requestTimeoutMs),
        redirect: "error",
      });

      if (!response.ok) {
        throw new Error("Domain provider unavailable");
      }

      const value: unknown = await response.json();
      const schema = method === "DELETE" ? DeletionEnvelopeSchema : EnvelopeSchema;
      const parsed = schema.safeParse(value);

      if (!parsed.success) {
        throw new Error("Domain provider envelope invalid");
      }

      return parsed.data;
    });
}

/** Bounded, redacted API access. This adapter has no paid certificate-order or DNS-write capability. */
export function createPreviewDomainProvider(credentials: PreviewCredentials) {
  const accountPath = `/accounts/${credentials.accountId}/workers/domains`;
  const zonePath = `/zones/${credentials.domains.zoneId}`;

  const request = createDomainRequest(credentials);

  const list = <T>(path: string, schema: z.ZodType<T>, paginated: boolean) =>
    Effect.gen(function* () {
      const rows: T[] = [];

      for (let page = 1; page <= maximumInventoryPages; page++) {
        const separator = path.includes("?") ? "&" : "?";
        const pagination = `${separator}page=${page}&per_page=${inventoryPageSize}`;
        const suffix = paginated ? pagination : "";
        const envelope = yield* request(`${path}${suffix}`);
        const parsed = z.array(schema).safeParse(envelope.result);

        if (!parsed.success) {
          return yield* Effect.fail(
            new PreviewFailure({ operation: "Preview domain inventory invalid" }),
          );
        }

        rows.push(...parsed.data);

        const totalPages = envelope.result_info?.total_pages;
        let complete = parsed.data.length < inventoryPageSize;

        if (totalPages !== undefined) {
          complete = page >= totalPages;
        }

        complete ||= !paginated;

        if (complete) {
          return rows;
        }
      }

      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview domain inventory limit exceeded" }),
      );
    });

  const verifyZone = () =>
    Effect.gen(function* () {
      const envelope = yield* request(zonePath);
      const parsed = ZoneSchema.safeParse(envelope.result);

      if (!parsed.success) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview zone unavailable or inactive" }),
        );
      }

      const matches =
        parsed.data.id === credentials.domains.zoneId &&
        parsed.data.name === credentials.domains.zoneName &&
        parsed.data.account.id === credentials.accountId;

      if (!matches) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview zone account identity mismatch" }),
        );
      }

      return yield* Effect.void;
    });

  const attach = (domain: PreviewDomainState) =>
    Effect.gen(function* () {
      const envelope = yield* request(accountPath, "PUT", {
        hostname: domain.hostname,
        service: domain.service,
        zone_id: credentials.domains.zoneId,
      });

      const parsed = CloudflareDomainSchema.safeParse(envelope.result);

      if (!parsed.success) {
        return yield* Effect.fail(
          new PreviewFailure({ operation: "Preview attached domain identity invalid" }),
        );
      }

      return parsed.data;
    });

  return {
    verifyZone,
    listDomains: () => list(accountPath, CloudflareDomainSchema, false),
    listDns: (hostname: string) =>
      list(
        `${zonePath}/dns_records?name=${encodeURIComponent(hostname)}`,
        CloudflareDnsRecordSchema,
        true,
      ),
    listCertificates: () =>
      list(`${zonePath}/ssl/certificate_packs?status=all`, CloudflareCertificatePackSchema, true),
    attach,
    detach: (id: string) =>
      request(`${accountPath}/${encodeURIComponent(id)}`, "DELETE").pipe(Effect.asVoid),
    deleteCertificate: (id: string) =>
      request(`${zonePath}/ssl/certificate_packs/${encodeURIComponent(id)}`, "DELETE").pipe(
        Effect.asVoid,
      ),
  };
}

export type PreviewDomainProvider = ReturnType<typeof createPreviewDomainProvider>;
