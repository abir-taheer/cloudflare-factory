import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { previewRecord } from "../preview-model.ts";
import { readPreviewVerificationEmail } from "./preview-email-inbox.ts";
import type { PreviewVerificationInbox } from "./preview-email-inbox.ts";

const passwordEntropyBytes = 24;
const hexadecimalRadix = 16;
const hexadecimalByteWidth = 2;
const httpForbidden = 403;
const httpOk = 200;
const httpFound = 302;

/** Public frontend and API use separate origins; no proxy or service binding is exercised. */
export interface PreviewPublicUrls {
  api: string;
  frontend: string;
}

/** Follow normal signup, email verification and login; never edit auth rows or mint test sessions. */
export async function createPreviewVerifiedSession(
  context: BrowserContext,
  urls: PreviewPublicUrls,
  inbox: PreviewVerificationInbox,
): Promise<void> {
  const email = `preview-${randomUUID()}@example.invalid`;

  const password = Array.from(randomBytes(passwordEntropyBytes), (byte) =>
    byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0"),
  ).join("");

  const headers = { Origin: urls.frontend, "Content-Type": "application/json" };

  const signup = await context.request.post(`${urls.api}/api/auth/sign-up/email`, {
    headers,
    data: { name: "Preview verification", email, password, callbackURL: urls.frontend },
    maxRedirects: 0,
  });

  if (!signup.ok()) {
    throw new Error("Preview signup failed");
  }

  const unverified = await context.request.post(`${urls.api}/api/auth/sign-in/email`, {
    headers,
    data: { email, password },
    maxRedirects: 0,
  });

  if (unverified.status() !== httpForbidden) {
    throw new Error("Preview unverified login was not denied");
  }

  const verificationUrl = await readPreviewVerificationEmail(inbox, email, urls);

  const verification = await context.request.get(verificationUrl, {
    headers: { Origin: urls.frontend },
    maxRedirects: 0,
  });

  if (verification.status() !== httpOk && verification.status() !== httpFound) {
    throw new Error("Preview email verification failed");
  }

  const signin = await context.request.post(`${urls.api}/api/auth/sign-in/email`, {
    headers,
    data: { email, password },
    maxRedirects: 0,
  });

  if (!signin.ok()) {
    throw new Error("Preview verified login failed");
  }

  const session = await context.request.get(`${urls.api}/api/auth/get-session`, {
    headers: { Origin: urls.frontend },
    maxRedirects: 0,
  });

  const sessionValue: unknown = await session.json();
  const user = previewRecord(previewRecord(sessionValue)["user"]);

  if (!session.ok() || user["email"] !== email || user["emailVerified"] !== true) {
    throw new Error("Preview verified session unavailable");
  }
}
