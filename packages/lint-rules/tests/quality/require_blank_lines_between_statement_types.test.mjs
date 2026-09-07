import { requireBlankLinesBetweenStatementTypes } from "../../rules/quality/require_blank_lines_between_statement_types.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run(
  "require-blank-lines-between-statement-types",
  requireBlankLinesBetweenStatementTypes,
  {
    valid: [
      // Same-type neighbors never need separation.
      `
        const a = 1;
        const b = 2;
        const c = 3;
      `,
      // A blank line already separates a type change.
      `
        const a = 1;

        if (a > 0) {
          callA();
        }
      `,
      `
        import { x } from "mod";

        const a = 1;
      `,
      // Exported declarations group with plain declarations.
      `
        const a = 1;
        export const b = 2;
      `,
      `
        export function f() {}
        export class C {}
      `,
      // TypeScript-only declarations group with plain declarations.
      `
        interface Config {
          a: string;
        }

        type Alias = Config;
        const value: Alias = { a: "x" };
      `,
      // A comment line between type changes still needs a real blank line,
      // and the comment attaches to the following statement.
      `
        const a = 1;

        // explains the branch
        if (a > 0) {
          callA();
        }
      `,
      // Trailing comments stay attached to the previous statement.
      `
        const a = 1; // trailing note

        if (a > 0) {
          callA();
        }
      `,
      // The last statement in a block has no successor.
      `
        if (a > 0) {
          callA();
        }
      `,
      // A declaration may pair with the single statement that uses it.
      `
        const a = 1;
        console.log(a);
      `,
      // Declaration-use pairs chain when a blank line separates the pairs.
      `
        const a = make();
        use(a);

        const b = make();
        use(b);
      `,
      // A return can close a declaration-use pair.
      `
        function f() {
          const x = compute();
          return x;
        }
      `,
      // The pair stays legal when a different statement group follows,
      // because that boundary forces its own blank line.
      `
        const a = make();
        use(a);

        if (ready) {
          start();
        }
      `,
    ],
    invalid: [
      // The user's motivating example: declarations then control flow.
      {
        code: `
          const a = 1;
          if (a <= 0) {
            callA();
          }
        `,
        output: `
          const a = 1;

          if (a <= 0) {
            callA();
          }
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // A pack of three is not a pair: the declaration boundary needs the
      // blank line when two plain statements follow.
      {
        code: `
          const a = 1;
          use(a);
          more(a);
        `,
        output: `
          const a = 1;

          use(a);
          more(a);
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // Back-to-back pairs still need a blank line between the pairs.
      {
        code: `
          const a = make();
          use(a);
          const b = make();
          use(b);
        `,
        output: `
          const a = make();
          use(a);

          const b = make();
          use(b);
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // Control flow never joins a declaration-use pair.
      {
        code: `
          const a = 1;
          if (a > 0) {
            use(a);
          }
        `,
        output: `
          const a = 1;

          if (a > 0) {
            use(a);
          }
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      {
        code: `
          import { x } from "mod";
          const a = 1;
        `,
        output: `
          import { x } from "mod";

          const a = 1;
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // A comment-only line between statements is not a blank line.
      {
        code: `
          const a = 1;
          // explains the branch
          if (a > 0) {
            callA();
          }
        `,
        output: `
          const a = 1;

          // explains the branch
          if (a > 0) {
            callA();
          }
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // The fixer keeps trailing comments on the previous statement's line.
      {
        code: `
          const a = 1; // trailing note
          if (a > 0) {
            callA();
          }
        `,
        output: `
          const a = 1; // trailing note

          if (a > 0) {
            callA();
          }
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // An export after a different kind still counts as a type change.
      {
        code: `
          if (ready) {
            start();
          }
          export function f() {}
        `,
        output: `
          if (ready) {
            start();
          }

          export function f() {}
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // TypeScript declarations versus control flow.
      {
        code: `
          interface Config {
            a: string;
          }
          if (ready) {
            start();
          }
        `,
        output: `
          interface Config {
            a: string;
          }

          if (ready) {
            start();
          }
        `,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // Same-line statements are reported but not auto-fixed; splitting
      // them onto separate lines needs manual restructuring.
      {
        code: `const a = 1; if (a > 0) { callA(); }`,
        output: null,
        errors: [{ messageId: "missingBlankLine" }],
      },
      // Switch case bodies are checked like block bodies.
      {
        code: `
          switch (kind) {
            case "a": {
              break;
            }
            case "b":
              const b = 2;
              if (b > 0) {
                callB();
              }
              break;
          }
        `,
        output: `
          switch (kind) {
            case "a": {
              break;
            }
            case "b":
              const b = 2;

              if (b > 0) {
                callB();
              }

              break;
          }
        `,
        errors: [{ messageId: "missingBlankLine" }, { messageId: "missingBlankLine" }],
      },
    ],
  },
);
