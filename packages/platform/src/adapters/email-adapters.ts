import { Layer } from "effect";
import type  { Transporter } from "nodemailer";
import { Email, type EmailMessage } from "../capability-services.js";
import { capabilityOperation } from "./capability-operation.js";

/** SMTP transport is caller-owned; rejected recipients are surfaced as failures. */
export const smtpEmailLayer = (transport: Transporter<{ rejected: readonly unknown[]; accepted: readonly unknown[] }>) => Layer.succeed(Email, Email.of({
  send: (message) => capabilityOperation("email", "send", async () => {
    const result = await transport.sendMail(message);
    if (result.rejected.length > 0 || result.accepted.length === 0) throw new Error("SMTP recipient rejected");
  }),
}));
/** Cloudflare email sender accepts a real binding and its runtime EmailMessage factory. */
export const cloudflareEmailLayer = <Message>(binding: { send(message: Message): Promise<unknown> }, makeMessage: (message: EmailMessage) => Message) => Layer.succeed(Email, Email.of({
  send: (message) => capabilityOperation("email", "send", async () => { await binding.send(makeMessage(message)); }),
}));
