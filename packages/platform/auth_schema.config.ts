import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/** Schema-generation input only: no real database, credentials, email transport, or runtime fallback. */
export const auth = betterAuth({
  database: drizzleAdapter(
    drizzle({
      client: new Pool({ connectionString: "postgresql://schema.invalid/schema" }),
      jit: false,
    }),
    { provider: "pg" },
  ),
  secret: "schema-generation-only-not-a-runtime-secret",
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  rateLimit: { enabled: true, storage: "database" },
});
