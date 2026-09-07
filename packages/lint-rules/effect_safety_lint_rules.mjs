import { noEffectRun } from "./rules/effect/no_effect_run.mjs";
import { noIgnoredCauseCallback } from "./rules/effect/no_ignored_cause_callback.mjs";
import { noSecretMaterialInLogs } from "./rules/security/no_secret_material_in_logs.mjs";
import { noTacitEffectCombinators } from "./rules/effect/no_tacit_effect_combinators.mjs";
import { noTryInEffectCallback } from "./rules/effect/no_try_in_effect_callback.mjs";
import { noConditionalLogLevel } from "./rules/effect/no_conditional_log_level.mjs";
import { noSyncNodeIo } from "./rules/security/no_sync_node_io.mjs";
import { preferAwaitToCallbacks } from "./rules/effect/prefer_await_to_callbacks.mjs";
import { preferAwaitToThen } from "./rules/effect/prefer_await_to_then.mjs";

/** Groups effect safety lint rules without weakening individual rule enforcement. */
export const effectSafetyLintRules = {
  "no-effect-run": noEffectRun,
  "no-ignored-cause-callback": noIgnoredCauseCallback,
  "no-secret-material-in-logs": noSecretMaterialInLogs,
  "no-tacit-effect-combinators": noTacitEffectCombinators,
  "no-try-in-effect-callback": noTryInEffectCallback,
  "no-conditional-log-level": noConditionalLogLevel,
  "no-sync-node-io": noSyncNodeIo,
  "prefer-await-to-callbacks": preferAwaitToCallbacks,
  "prefer-await-to-then": preferAwaitToThen,
};
