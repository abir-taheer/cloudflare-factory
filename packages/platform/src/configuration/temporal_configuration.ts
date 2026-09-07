import { z } from "zod";

const TemporalSecretSchema = z.string().trim().min(1);

const TemporalSecurityInputSchema = z.object({
  tls: z.boolean().optional(),
  apiKey: TemporalSecretSchema.optional(),
  serverCa: TemporalSecretSchema.optional(),
  clientCert: TemporalSecretSchema.optional(),
  clientKey: TemporalSecretSchema.optional(),
  serverName: z.string().regex(/^\S+$/u).optional(),
});

/** Missing TLS flags enable encryption when credentials or TLS settings are present. */
export function temporalRequiresTls(value: z.infer<typeof TemporalSecurityInputSchema>): boolean {
  return (
    value.apiKey !== undefined ||
    value.serverCa !== undefined ||
    value.clientCert !== undefined ||
    value.clientKey !== undefined ||
    value.serverName !== undefined
  );
}

/** Temporal credentials and certificate material require verified TLS. */
export const TemporalSecuritySchema = TemporalSecurityInputSchema.refine(
  (value) => (value.clientCert === undefined) === (value.clientKey === undefined),
  "Temporal client certificate and key must be supplied together",
).refine(
  (value) => value.tls !== false || !temporalRequiresTls(value),
  "Temporal authentication and certificate settings require TLS",
);

/** Raw PEM environment values are passed to the SDK; no file or profile fallback is loaded. */
export const TemporalEnvironmentSchema = z
  .object({
    TEMPORAL_TLS: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    TEMPORAL_API_KEY: TemporalSecuritySchema.shape.apiKey,
    TEMPORAL_TLS_SERVER_CA_CERT_DATA: TemporalSecuritySchema.shape.serverCa,
    TEMPORAL_TLS_CLIENT_CERT_DATA: TemporalSecuritySchema.shape.clientCert,
    TEMPORAL_TLS_CLIENT_KEY_DATA: TemporalSecuritySchema.shape.clientKey,
    TEMPORAL_TLS_SERVER_NAME: TemporalSecuritySchema.shape.serverName,
  })
  .transform((value): z.infer<typeof TemporalSecuritySchema> => ({
    tls: value.TEMPORAL_TLS,
    apiKey: value.TEMPORAL_API_KEY,
    serverCa: value.TEMPORAL_TLS_SERVER_CA_CERT_DATA,
    clientCert: value.TEMPORAL_TLS_CLIENT_CERT_DATA,
    clientKey: value.TEMPORAL_TLS_CLIENT_KEY_DATA,
    serverName: value.TEMPORAL_TLS_SERVER_NAME,
  }))
  .pipe(TemporalSecuritySchema);

/** Explicit Temporal environment keys keep credential loading bounded. */
export const temporalEnvironmentKeys = [
  "TEMPORAL_TLS",
  "TEMPORAL_API_KEY",
  "TEMPORAL_TLS_SERVER_CA_CERT_DATA",
  "TEMPORAL_TLS_CLIENT_CERT_DATA",
  "TEMPORAL_TLS_CLIENT_KEY_DATA",
  "TEMPORAL_TLS_SERVER_NAME",
];
