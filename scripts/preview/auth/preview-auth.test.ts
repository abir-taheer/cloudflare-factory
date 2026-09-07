import assert from "node:assert/strict";
import test from "node:test";
import { derivePreviewSessionSecret } from "../preview-model.ts";
import { extractPreviewVerificationUrl } from "./preview-email-inbox.ts";

process.env["RESOURCE_PREFIX"] = "test";

const owner = { accountId: "a".repeat(32), repositoryId: "123", pr: 42 };
const urls = { api: "https://api.example.test", frontend: "https://frontend.example.test" };

test("session signing keys are stable within one PR and isolated across accounts, repositories and PRs", () => {
  const base = "synthetic-session-base-at-least-32-characters";
  const secret = derivePreviewSessionSecret(base, owner);

  assert.notEqual(secret, base);
  assert.equal(secret, derivePreviewSessionSecret(base, owner));

  for (const other of [
    { ...owner, pr: 43 },
    { ...owner, repositoryId: "456" },
    { ...owner, accountId: "b".repeat(32) },
  ]) {
    assert.notEqual(secret, derivePreviewSessionSecret(base, other));
  }

  assert.throws(() => derivePreviewSessionSecret("short", owner));
});

test("private inbox verification accepts only the exact recipient and deployment origins", () => {
  const link = `${urls.api}/api/auth/verify-email?token=synthetic&callbackURL=${encodeURIComponent(urls.frontend)}`;

  const message = {
    to: "person@example.invalid",
    subject: "Verify email",
    text: `Verify email\n\n${link}\n\nIgnore if not requested.`,
  };

  assert.equal(extractPreviewVerificationUrl(message, " PERSON@example.invalid ", urls), link);
  assert.throws(() => extractPreviewVerificationUrl(message, "other@example.invalid", urls));

  assert.equal(
    extractPreviewVerificationUrl(
      { ...message, text: link.replace(urls.api, "https://foreign.invalid") },
      message.to,
      urls,
    ),
    null,
  );

  assert.throws(() =>
    extractPreviewVerificationUrl(
      {
        ...message,
        text: `${urls.api}/api/auth/verify-email?token=synthetic&callbackURL=https://foreign.invalid`,
      },
      message.to,
      urls,
    ),
  );
});
