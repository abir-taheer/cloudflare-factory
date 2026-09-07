import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigProvider, Effect } from "effect";
import { z } from "zod";
import { CapabilityError, Email } from "./capability-services.js";
import { createPortableSmtpTransport } from "./adapters/smtp-transport.js";
import { smtpEmailLayer } from "./adapters/email-adapters.js";
import { parsePortableConfiguration } from "./configuration/portable-configuration.js";
import { readIntegrationConfiguration } from "./testing/integration-configuration.js";

const settings = Effect.runSync(
  readIntegrationConfiguration([
    "PLATFORM_SMTP_INTEGRATION",
    "SMTP_STARTTLS_HOST",
    "SMTP_TLS_HOST",
  ]),
);

const enabled = settings["PLATFORM_SMTP_INTEGRATION"] === "1";

const MailpitMessagesSchema = z.object({
  messages: z.array(z.object({ To: z.array(z.object({ Address: z.string() })) })),
});

test(
  "real authenticated SMTP delivers through verified STARTTLS and implicit TLS, rejects wrong credentials",
  {
    skip: !enabled,
    timeout: 30_000,
  },
  async () => {
    const configuration = Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnv()));
    const authentication = configuration.smtpAuth;
    assert.ok(authentication);

    const deliveries = [false, true].map(async (secure) => {
      const host = settings[secure ? "SMTP_TLS_HOST" : "SMTP_STARTTLS_HOST"];
      assert.ok(host !== undefined);

      const recipient = `${randomUUID()}@example.test`;

      const transport = createPortableSmtpTransport({
        ...configuration,
        smtpHost: host,
        smtpSecure: secure,
        smtpRequireTls: !secure,
      });

      try {
        await Effect.runPromise(
          Email.pipe(
            Effect.flatMap((email) =>
              email.send({
                from: "test@example.test",
                to: recipient,
                subject: "TLS delivery",
                text: "Verified SMTP transport",
              }),
            ),
            Effect.provide(smtpEmailLayer(transport)),
          ),
        );

        const response = await fetch(`http://${host}:8025/api/v1/messages`, {
          signal: AbortSignal.timeout(5000),
        });

        assert.equal(response.status, 200);

        const body: unknown = await response.json();
        const inbox = MailpitMessagesSchema.parse(body);

        assert.ok(
          inbox.messages.some((message) =>
            message.To.some((address) => address.Address === recipient),
          ),
        );
      } finally {
        transport.close();
      }

      const rejected = createPortableSmtpTransport({
        ...configuration,
        smtpHost: host,
        smtpSecure: secure,
        smtpRequireTls: !secure,
        smtpAuth: { user: authentication.user, pass: randomUUID() },
      });

      try {
        const failure = await Effect.runPromise(
          Email.pipe(
            Effect.flatMap((email) =>
              email.send({
                from: "test@example.test",
                to: recipient,
                subject: "Rejected",
                text: "Wrong credentials",
              }),
            ),
            Effect.provide(smtpEmailLayer(rejected)),
            Effect.flip,
          ),
        );

        assert.ok(failure instanceof CapabilityError);
      } finally {
        rejected.close();
      }
    });

    await Promise.all(deliveries);
  },
);
