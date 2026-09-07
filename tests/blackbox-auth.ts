import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { z } from "zod";
import { ApiHealthSchema } from "@factory/api-contract/schema";
import { blackboxConfiguration } from "./blackbox-configuration.js";

import { expectCorsHeaders } from "./blackbox-http.js";

const MessageSummarySchema = z.object({ ID: z.string(), Subject: z.string() });
const MessageSearchSchema = z.object({ messages: z.array(MessageSummarySchema) });
const MessageSchema = MessageSummarySchema.extend({ Text: z.string() });
const TestAccountSchema = z.object({ email: z.email(), password: z.string().min(12) });

export type TestAccount = z.infer<typeof TestAccountSchema>;

/** Search only this test recipient; never export inbox contents or verification tokens. */
export async function readEmailLink(request: APIRequestContext, email: string, subject: string) {
  let messageId = "";

  await expect
    .poll(
      async () => {
        const response = await request.get(`${blackboxConfiguration.MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:${email}` },
        });

        expect(response.ok()).toBe(true);

        const value: unknown = await response.json();
        const search = MessageSearchSchema.parse(value);

        messageId = search.messages.find((message) => message.Subject === subject)?.ID ?? "";
        return messageId.length > 0;
      },
      { timeout: 30_000, message: "The real SMTP adapter must deliver the account email" },
    )
    .toBe(true);

  const response = await request.get(
    `${blackboxConfiguration.MAILPIT_URL}/api/v1/message/${messageId}`,
  );

  const value: unknown = await response.json();
  const message = MessageSchema.parse(value);
  const link = z.url().parse(/https?:\/\/[^\s<>]+/u.exec(message.Text)?.[0]);

  expect(new URL(link).origin).toBe(blackboxConfiguration.API_URL);
  return link;
}

/** Form-driven authentication exercises Better Auth's credentialed cross-origin transport. */
export async function signIn(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByLabel(/^Email address/u).fill(account.email);
  await page.getByLabel(/^Password/u).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
}

/** Establish an account using real signup, delivered verification and official UI sign-in. */
export async function createVerifiedAccount(page: Page): Promise<TestAccount> {
  const health = await page.request.get(`${blackboxConfiguration.API_URL}/healthz`);
  const value: unknown = await health.json();
  expect(ApiHealthSchema.parse(value).environment).toBe("dev");

  const account = TestAccountSchema.parse({
    email: `browser-${randomUUID()}@example.test`,
    password: `Local-test-${randomUUID()}`,
  });

  await page.goto("/signup");
  await page.getByLabel(/^Your name/u).fill("Developer");
  await page.getByLabel(/^Email address/u).fill(account.email);
  await page.getByLabel(/^Password/u).fill(account.password);

  const signup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
      response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Create account", exact: true }).click();

  const signupResponse = await signup;

  expect(signupResponse.status()).toBe(200);
  expectCorsHeaders(signupResponse);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const verification = await readEmailLink(
    page.request,
    account.email,
    "Verify your email address",
  );

  await page.goto(verification);
  await expect(page.getByText("Email verified. You can sign in now.")).toBeVisible();
  await signIn(page, account);
  return account;
}
