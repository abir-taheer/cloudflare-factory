import { noSyncNodeIo } from "../../rules/security/no-sync-node-io.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-sync-node-io", noSyncNodeIo, {
  valid: [
    'import { Effect, Schema } from "effect"; Effect.runSync(program); Schema.decodeUnknownSync(schema);',
    'import { readFile } from "node:fs/promises"; await readFile(filename);',
    'import fs from "node:fs"; function useOther(fs) { fs.readFileSync(filename); }',
  ],
  invalid: [
    {
      code: 'import fs from "node:fs"; fs.readFileSync(filename);',
      errors: [{ messageId: "useAsyncIo" }],
    },
    {
      code: 'import { readFileSync as read } from "node:fs"; read(filename);',
      errors: [{ messageId: "useAsyncIo" }],
    },
    {
      code: 'import * as childProcess from "node:child_process"; childProcess.spawnSync(command);',
      errors: [{ messageId: "useAsyncIo" }],
    },
  ],
});
