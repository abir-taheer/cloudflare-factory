import { canonicalContractImports } from "./rules/api/canonical_contract_imports.mjs";
import { noDeprecatedZodStringValidators } from "./rules/api/no_deprecated_zod_string_validators.mjs";
import { noInlineZodInCreateRoute } from "./rules/api/no_inline_zod_in_create_route.mjs";
import { oneCreateRoutePerFile } from "./rules/api/one_create_route_per_file.mjs";
import { zodSchemaConstNames } from "./rules/api/zod_schema_const_names.mjs";
import { noUntypedApiRoutes } from "./rules/api/no_untyped_api_routes.mjs";
import { noEffectSchema } from "./rules/api/no_effect_schema.mjs";
import { noReannotatedAuthContext } from "./rules/api/no_reannotated_auth_context.mjs";
import { requireSchemaDerivedContracts } from "./rules/api/require_schema_derived_contracts.mjs";

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
