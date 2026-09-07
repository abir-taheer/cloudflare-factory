import { noInlineAwaitInArguments } from "../../rules/quality/no_inline_await_in_arguments.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-inline-await-in-arguments", noInlineAwaitInArguments, {
  valid: [
    "async function run() { const loaded = await load(); use(loaded); }",
    "async function run() { await save(record); }",
    "async function run() { const result = await outer(inner(1)); return result; }",
    'test("case", async () => { const value = await fetchValue(); check(value); });',
  ],
  invalid: [
    {
      code: "async function run() { use(await load()); }",
      errors: [{ messageId: "hoistAwait" }],
    },
    {
      code: "async function run() { const client = new Client(await resolveSecret()); }",
      errors: [{ messageId: "hoistAwait" }],
    },
    {
      code: "async function run() { register({ key: await loadKey() }); }",
      errors: [{ messageId: "hoistAwait" }],
    },
    {
      code: "async function run() { compare(await left(), await right()); }",
      errors: [{ messageId: "hoistAwait" }, { messageId: "hoistAwait" }],
    },
  ],
});
