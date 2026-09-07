import { z } from "zod";

/** Hyperdrive's require mode validates public server certificates through WebPKI without an uploaded CA. */
export const hyperdriveConnectionPolicy = {
  caching: { disabled: true },
  mtls: { sslmode: "require" },
  origin_connection_limit: 5,
} as const;

const HyperdriveConnectionPolicySchema = z.object({
  caching: z.object({ disabled: z.literal(hyperdriveConnectionPolicy.caching.disabled) }),
  mtls: z.object({
    sslmode: z.literal(hyperdriveConnectionPolicy.mtls.sslmode),
    ca_certificate_id: z.null().optional(),
    mtls_certificate_id: z.null().optional(),
  }),
  origin_connection_limit: z.literal(hyperdriveConnectionPolicy.origin_connection_limit),
});

/** Provider readback must retain verified TLS, uncached queries and the bounded origin pool. */
export function verifyHyperdriveConnectionPolicy(configuration: unknown) {
  const result = HyperdriveConnectionPolicySchema.safeParse(configuration);

  if (!result.success) {
    throw new Error("Hyperdrive connection policy drift");
  }
}
