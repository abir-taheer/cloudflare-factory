import { getSandbox } from "@cloudflare/sandbox";
import { cloudflareSandboxLayer, unavailableSandboxLayer } from "@factory/platform/cloudflare";

/** Optional SDK namespace is independent of the application's required bindings. */
export interface CloudflareSandboxBindings {
  readonly SANDBOX?: Parameters<typeof getSandbox>[0];
}

/** Callers supply an ownership-scoped ID; missing bindings never start a sandbox. */
export const optionalCloudflareSandboxLayer = (
  bindings: CloudflareSandboxBindings,
  sandboxId: string,
) => {
  if (bindings.SANDBOX === undefined) {
    return unavailableSandboxLayer;
  }

  return cloudflareSandboxLayer(getSandbox(bindings.SANDBOX, sandboxId));
};
