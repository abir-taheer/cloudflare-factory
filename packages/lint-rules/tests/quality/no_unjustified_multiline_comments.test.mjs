import { noUnjustifiedMultilineComments } from "../../rules/quality/no_unjustified_multiline_comments.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("no-unjustified-multiline-comments", noUnjustifiedMultilineComments, {
  valid: [
    // One- and two-line comments are friction-free.
    `
      // The proxy is the only trusted boundary for plaintext.
      const boundary = true;
    `,
    `
      // AWS caps KMS encryption context values at 256 bytes,
      // so the toolkit scope is hashed before binding.
      const scope = hash(toolkit);
    `,
    // Three or more lines are fine when opened with the escape.
    `
      // comment-necessary: the JWE alg allowlist is a security invariant that is not
      // visible at the call site. Accepting any provider-advertised algorithm
      // would let a downgraded RSA1_5 token through the sealing boundary.
      const ALLOWED_ALGORITHMS = ["RSA-OAEP-256"];
    `,
    `
      /* comment-necessary: this shape mirrors the wire format frozen in the v1 API
         contract; field order and names cannot change without a version bump.
         Renaming these fields breaks deployed clients. */
      const wireFormat = { v: 1 };
    `,
    // Separate short comments interleaved with code never form a block.
    `
      // Validate the input.
      const parsed = schema.parse(input);
      // Then bind the scope.
      const scope = bind(parsed);
      // Then seal.
      const sealed = seal(scope);
    `,
    // Trailing comments do not join a block.
    `
      const a = 1; // first
      const b = 2; // second
      const c = 3; // third
    `,
    // Directive comments do not join a block.
    `
      // eslint-disable-next-line no-console
      // ok line one
      // ok line two
      console.log("x");
    `,
  ],
  invalid: [
    {
      code: `
        // Previously this used a plain Map, but that did not handle TTL.
        // Now we use the Cache service which deduplicates lookups.
        // This is the recommended approach.
        const cache = makeCache();
      `,
      errors: [{ messageId: "deleteShortenOrJustify" }],
    },
    {
      code: `
        /*
         * Loop over the fields and encrypt each one, collecting the results
         * into a new object. Fields that are not secret are passed through
         * unchanged.
         */
        const out = encryptFields(fields);
      `,
      errors: [{ messageId: "deleteShortenOrJustify" }],
    },
    {
      // The escape must open the block, not appear midway through.
      code: `
        // Encrypt each field in the payload.
        // comment-necessary: kept for the audit trail.
        // Non-secret fields pass through unchanged.
        const out = encryptFields(fields);
      `,
      errors: [{ messageId: "deleteShortenOrJustify" }],
    },
    {
      // An empty reason does not count as an escape.
      code: `
        // comment-necessary:
        // Loop over the fields and encrypt each one.
        // Fields that are not secret pass through.
        const out = encryptFields(fields);
      `,
      errors: [{ messageId: "deleteShortenOrJustify" }],
    },
  ],
});
