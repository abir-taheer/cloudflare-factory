import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { PortablePlatformConfig } from "../../configuration/portable_configuration.js";
import { SmtpSecuritySchema } from "../../configuration/smtp_configuration.js";

type PortableSmtpConfiguration = Pick<
  PortablePlatformConfig,
  "smtpHost" | "smtpPort" | "smtpSecure" | "smtpRequireTls" | "smtpAuth"
>;

/** SMTP transport uses normal certificate verification and caller-owned connection cleanup. */
export function createPortableSmtpTransport(config: PortableSmtpConfiguration) {
  const parsed = SmtpSecuritySchema.safeParse(config);

  if (!parsed.success) {
    throw new Error("Portable SMTP security configuration invalid: authentication requires TLS");
  }

  const options: SMTPTransport.Options = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: parsed.data.smtpSecure ?? false,
    requireTLS: parsed.data.smtpRequireTls ?? false,
  };

  if (parsed.data.smtpAuth !== undefined) {
    options.auth = parsed.data.smtpAuth;
  }

  return createTransport(options);
}
