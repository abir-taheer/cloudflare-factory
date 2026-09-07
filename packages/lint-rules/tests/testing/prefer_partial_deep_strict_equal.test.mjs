import { preferPartialDeepStrictEqual } from "../../rules/testing/prefer_partial_deep_strict_equal.mjs";
import { createTypescriptRuleTester } from "../testing.mjs";

const ruleTester = createTypescriptRuleTester();

ruleTester.run("prefer-partial-deep-strict-equal", preferPartialDeepStrictEqual, {
  valid: [
    // A single property assert is fine.
    'assert.equal(result.left._tag, "EncryptionConfigError");',
    // Different objects never form a run.
    `
      assert.equal(first.status, 200);
      assert.equal(second.status, 201);
      assert.equal(third.status, 204);
    `,
    // A non-assert statement between asserts breaks the run.
    `
      assert.equal(jwk.kty, "RSA");
      const kid = jwk.kid;
      assert.equal(jwk.use, "enc");
    `,
    // Collection-shape asserts are explicit checks, not structural matches.
    `
      assert.equal(adapter.kids.size, 2);
      assert.equal(requests.length, 0);
      assert.equal(names.length, 3);
    `,
    // Absence checks stay separate: a partial match cannot assert a key is missing.
    `
      assert.equal(result.headers["content-length"], undefined);
      assert.equal(result.headers["transfer-encoding"], undefined);
    `,
    // The suggested replacement itself.
    'assert.partialDeepStrictEqual(jwk, { kty: "RSA", alg: "RSA-OAEP-256", kid: "k1" });',
    // Repeating the same property is not a shape assertion.
    `
      assert.equal(counter.value, 1);
      assert.equal(counter.value, 1);
      assert.equal(counter.value, 1);
    `,
  ],
  invalid: [
    {
      code: `
        assert.equal(result.left._tag, "EncryptionConfigError");
        assert.equal(result.left.kind, "invalid_json");
      `,
      errors: [{ messageId: "useStructuralMatch" }],
    },
    {
      code: `
        assert.equal(jwk.kty, "RSA");
        assert.equal(jwk.alg, "RSA-OAEP-256");
        assert.equal(jwk.use, "enc");
        assert.equal(jwk.kid, "kid-1");
      `,
      errors: [{ messageId: "useStructuralMatch" }],
    },
    {
      code: `
        assert.strictEqual(result.left._tag, "SealedSecretError");
        assert.equal(result.left.kind, "decrypt_failed");
        assert.deepEqual(result.left.toolkit, "gmail");
      `,
      errors: [{ messageId: "useStructuralMatch" }],
    },
    {
      code: `
        assert.equal(log.annotations["audit.action"], "generate_dek");
        assert.equal(log.annotations["audit.outcome"], "success");
        assert.equal(log.annotations["audit.toolkit"], "gmail");
      `,
      errors: [{ messageId: "useStructuralMatch" }],
    },
    {
      code: `
        it("returns the jwk", () => {
          assert.equal(jwk.kty, "RSA");
          assert.equal(jwk.alg, "RSA-OAEP-256");
          assert.equal(jwk.kid, "k1");
        });
      `,
      errors: [{ messageId: "useStructuralMatch" }],
    },
  ],
});
