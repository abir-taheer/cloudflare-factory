import { noEffectRun } from "./rules/effect/no-effect-run.mjs";
import { noIgnoredCauseCallback } from "./rules/effect/no-ignored-cause-callback.mjs";
import { noSecretMaterialInLogs } from "./rules/security/no-secret-material-in-logs.mjs";
import { noTacitEffectCombinators } from "./rules/effect/no-tacit-effect-combinators.mjs";
import { noTryInEffectCallback } from "./rules/effect/no-try-in-effect-callback.mjs";
import { noConditionalLogLevel } from "./rules/effect/no-conditional-log-level.mjs";
import { noSyncNodeIo } from "./rules/security/no-sync-node-io.mjs";
import { preferAwaitToCallbacks } from "./rules/effect/prefer-await-to-callbacks.mjs";
import { preferAwaitToThen } from "./rules/effect/prefer-await-to-then.mjs";

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
