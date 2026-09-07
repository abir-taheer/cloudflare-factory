import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { setTimeout as delay } from "node:timers/promises";
import {
  parsePreviewManifest,
  previewRecord,
  previewResource,
  previewString,
} from "../preview_model.ts";
import type { PreviewManifest } from "../preview_model.ts";
import type { PreviewCredentials } from "../cloudflare/preview_cloudflare.ts";

const inboxPollLimit = 40;
const emailLimitBytes = 32_768;
const inboxPollDelayMs = 3000;

/** A preview inbox can inspect only an exact recipient in the manifest-owned private objects bucket. */
export interface PreviewVerificationInbox {
  credentials: PreviewCredentials;
  manifest: PreviewManifest;
}

/** Accept only BetterAuth email-verification links for this API and the exact frontend callback. */
export function extractPreviewVerificationUrl(
  message: unknown,
  recipient: string,
  urls: Readonly<Record<"api" | "frontend", string>>,
): string | null {
  const value = previewRecord(message);

  const matchesRecipient =
    previewString(value["to"]).trim().toLowerCase() === recipient.trim().toLowerCase();

  if (!matchesRecipient) {
    throw new Error("Preview inbox recipient mismatch");
  }

  const links = previewString(value["text"]).match(/https?:\/\/[^\s<>"']+/gu) ?? [];

  for (const link of links) {
    const url = new URL(link);

    if (url.origin === urls.api && url.pathname === "/api/auth/verify-email") {
      const callback = url.searchParams.get("callbackURL");

      if (
        url.username.length > 0 ||
        url.password.length > 0 ||
        !url.searchParams.has("token") ||
        callback === null ||
        new URL(callback).origin !== urls.frontend
      ) {
        throw new Error("Preview verification link target invalid");
      }

      return url.toString();
    }
  }

  return null;
}

/** Connection/session material is never printed; inbox objects are private and vanish with PR cleanup. */
export async function readPreviewVerificationEmail(
  inbox: PreviewVerificationInbox,
  recipient: string,
  urls: Readonly<Record<"api" | "frontend", string>>,
): Promise<string> {
  const manifest = parsePreviewManifest(inbox.manifest, inbox.manifest.owner);
  const bucket = previewResource(manifest, "objects");

  if (
    bucket.phase !== "ready" ||
    bucket.id !== bucket.name ||
    bucket.name === inbox.credentials.stateBucket ||
    manifest.owner.accountId !== inbox.credentials.accountId
  ) {
    throw new Error("Preview inbox ownership invalid");
  }

  const prefix = `auth-email/${createHash("sha256").update(recipient.trim().toLowerCase()).digest("hex")}/`;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${inbox.credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: inbox.credentials.s3Key,
      secretAccessKey: inbox.credentials.s3Secret,
    },
    maxAttempts: 3,
  });

  try {
    for (let attempt = 0; attempt < inboxPollLimit; attempt += 1) {
      const result = await client.send(
        new ListObjectsV2Command({ Bucket: bucket.name, Prefix: prefix, MaxKeys: 20 }),
      );

      if (result.IsTruncated === true) {
        throw new Error("Preview inbox recipient message limit exceeded");
      }

      for (const item of result.Contents ?? []) {
        if (
          item.Key === undefined ||
          !item.Key.startsWith(prefix) ||
          !/^[a-f0-9-]{36}\.json$/u.test(item.Key.slice(prefix.length)) ||
          (item.Size ?? 0) > emailLimitBytes
        ) {
          throw new Error("Preview inbox object invalid");
        }

        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket.name, Key: item.Key }),
        );

        if (response.Body === undefined) {
          throw new Error("Preview inbox object missing");
        }

        const text = await response.Body.transformToString();
        const value: unknown = JSON.parse(text);
        const url = extractPreviewVerificationUrl(value, recipient, urls);

        if (url !== null) {
          return url;
        }
      }

      await delay(inboxPollDelayMs);
    }

    throw new Error("Preview verification email deadline exceeded");
  } finally {
    client.destroy();
  }
}
