import type { ConnectionOptions } from "@temporalio/client";
import type { z } from "zod";
import {
  TemporalSecuritySchema,
  temporalRequiresTls,
} from "../../configuration/temporal_configuration.js";
import type { PortablePlatformConfig } from "../../configuration/portable_configuration.js";

type TemporalTlsOptions = Exclude<NonNullable<ConnectionOptions["tls"]>, boolean>;

type TemporalConnectionSettings = Pick<ConnectionOptions, "address" | "tls" | "apiKey"> &
  Pick<z.infer<typeof TemporalSecuritySchema>, "apiKey">;

/** Both Temporal SDK connections use the same verified TLS and bearer authentication settings. */
export function createTemporalConnectionOptions(
  config: Pick<PortablePlatformConfig, "temporalAddress" | "temporalSecurity">,
) {
  const parsed = TemporalSecuritySchema.safeParse(config.temporalSecurity ?? {});

  if (!parsed.success) {
    throw new Error("Temporal security configuration invalid");
  }

  const security = parsed.data;
  const enabled = security.tls ?? temporalRequiresTls(security);
  const tls: TemporalTlsOptions = {};
  const encoder = new TextEncoder();

  if (security.serverCa !== undefined) {
    tls.serverRootCACertificate = encoder.encode(security.serverCa);
  }

  if (security.serverName !== undefined) {
    tls.serverNameOverride = security.serverName;
  }

  if (security.clientCert !== undefined && security.clientKey !== undefined) {
    tls.clientCertPair = {
      crt: encoder.encode(security.clientCert),
      key: encoder.encode(security.clientKey),
    };
  }

  const options: TemporalConnectionSettings = {
    address: config.temporalAddress,
    tls: enabled ? tls : false,
  };

  if (security.apiKey !== undefined) {
    options.apiKey = security.apiKey;
  }

  return options;
}
