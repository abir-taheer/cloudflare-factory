import { canonicalContractImports } from "./rules/api/canonical-contract-imports.mjs";
import { noDeprecatedZodStringValidators } from "./rules/api/no-deprecated-zod-string-validators.mjs";
import { noInlineZodInCreateRoute } from "./rules/api/no-inline-zod-in-create-route.mjs";
import { oneCreateRoutePerFile } from "./rules/api/one-create-route-per-file.mjs";
import { zodSchemaConstNames } from "./rules/api/zod-schema-const-names.mjs";
import { noUntypedApiRoutes } from "./rules/api/no-untyped-api-routes.mjs";
import { noEffectSchema } from "./rules/api/no-effect-schema.mjs";
import { noReannotatedAuthContext } from "./rules/api/no-reannotated-auth-context.mjs";
import { requireSchemaDerivedContracts } from "./rules/api/require-schema-derived-contracts.mjs";

/** Groups api contract lint rules without weakening individual rule enforcement. */
export const apiContractLintRules = {
  "canonical-contract-imports": canonicalContractImports,
  "no-deprecated-zod-string-validators": noDeprecatedZodStringValidators,
  "no-inline-zod-in-create-route": noInlineZodInCreateRoute,
  "one-create-route-per-file": oneCreateRoutePerFile,
  "zod-schema-const-names": zodSchemaConstNames,
  "no-untyped-api-routes": noUntypedApiRoutes,
  "no-effect-schema": noEffectSchema,
  "no-reannotated-auth-context": noReannotatedAuthContext,
  "require-schema-derived-contracts": requireSchemaDerivedContracts,
};
