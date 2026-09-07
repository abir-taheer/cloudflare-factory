import { preferAwaitToCallbacks } from "../../rules/effect/prefer-await-to-callbacks.mjs";
import { preferAwaitToThen } from "../../rules/effect/prefer-await-to-then.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("prefer-await-to-then", preferAwaitToThen, {
  valid: [
    'import { Effect } from "effect"; program.pipe(Effect.catch((error) => Effect.succeed(error)));',
    'import * as Effect from "effect/Effect"; Effect.catch((error) => recover(error));',
    "async function load() { await promise.then(transform); }",
    "function load() { return promise.then(transform); }",
    "Promise.all(tasks);",
  ],
  invalid: [
    { code: "promise.then(transform);", errors: [{ messageId: "preferAwait" }] },
    { code: "promise.catch(handleFailure);", errors: [{ messageId: "preferAwait" }] },
    { code: 'promise["finally"](cleanup);', errors: [{ messageId: "preferAwait" }] },
    {
      code: "async function load() { await promise.then(transform); }",
      options: [{ strict: true }],
      errors: [{ messageId: "preferAwait" }],
    },
    {
      code: "function run(Effect) { Effect.catch(handleFailure); }",
      errors: [{ messageId: "preferAwait" }],
    },
    {
      code: 'import { Effect } from "effect"; function run(Effect) { Effect.catch(handleFailure); }',
      errors: [{ messageId: "preferAwait" }],
    },
  ],
});

ruleTester.run("prefer-await-to-callbacks", preferAwaitToCallbacks, {
  valid: [
    'import { Effect } from "effect"; Effect.tapError((error) => Effect.logError(error));',
    'import { Effect } from "effect"; Effect.catch(program, (error) => recover(error));',
    'emitter.on("error", (error) => record(error));',
    "errors.map((error) => error.code);",
    "_.map(errors, (error) => error.code);",
    "async function run() { await legacy((error) => record(error)); }",
  ],
  invalid: [
    {
      code: "readFile(filename, (error, bytes) => consume(error, bytes));",
      errors: [{ messageId: "preferAwait" }],
    },
    { code: "function load(cb) {}", errors: [{ messageId: "preferAwait" }] },
    { code: "callback();", errors: [{ messageId: "preferAwait" }] },
    {
      code: "function run(Effect) { Effect.tapError((error) => record(error)); }",
      errors: [{ messageId: "preferAwait" }],
    },
  ],
});
