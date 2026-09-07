import { z } from "zod";

const BooleanSettingSchema = z.enum(["true", "false"]).transform((value) => value === "true");
const SmtpCredentialSchema = z.string().min(1);

/** Authenticated SMTP must fail closed when encryption cannot be established. */
export const SmtpSecuritySchema = z
  .object({
    smtpSecure: z.boolean().optional(),
    smtpRequireTls: z.boolean().optional(),
    smtpAuth: z.object({ user: SmtpCredentialSchema, pass: SmtpCredentialSchema }).optional(),
  })
  .refine(
    (value) =>
      value.smtpAuth === undefined || value.smtpSecure === true || value.smtpRequireTls === true,
    "SMTP authentication requires TLS",
  );

/** SMTP credentials are optional as a pair; TLS flags use explicit lowercase booleans. */
export const SmtpEnvironmentSchema = z
  .object({
    SMTP_SECURE: BooleanSettingSchema.optional().default(false),
    SMTP_REQUIRE_TLS: BooleanSettingSchema.optional().default(false),
    SMTP_USERNAME: SmtpCredentialSchema.optional(),
    SMTP_PASSWORD: SmtpCredentialSchema.optional(),
  })
  .refine(
    (value) => (value.SMTP_USERNAME === undefined) === (value.SMTP_PASSWORD === undefined),
    "SMTP username and password must be supplied together",
  )
  .refine(
    (value) => value.SMTP_USERNAME === undefined || value.SMTP_SECURE || value.SMTP_REQUIRE_TLS,
    "SMTP authentication requires TLS",
  );

/** The transport receives no auth property for unauthenticated local SMTP. */
export function smtpEnvironmentOptions(value: z.infer<typeof SmtpEnvironmentSchema>) {
  const settings = {
    smtpSecure: value.SMTP_SECURE,
    smtpRequireTls: value.SMTP_REQUIRE_TLS,
  };

  if (value.SMTP_USERNAME === undefined || value.SMTP_PASSWORD === undefined) {
    return settings;
  }

  return {
    ...settings,
    smtpAuth: { user: value.SMTP_USERNAME, pass: value.SMTP_PASSWORD },
  };
}
