import type { Pool } from "pg";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createPostgresDrizzle } from "../adapters/postgres-database.js";
import { user } from "../adapters/schema/auth-schema.js";
import { capabilityOperation } from "../adapters/capability-operation.js";

/** Test identities are unique, verified fixtures; tests remove them through the auth foreign-key cascade. */
export const createVerifiedTestUser = (pool: Pool, id: string) =>
  capabilityOperation("testDatabase", "createUser", async () => {
    await createPostgresDrizzle(pool)
      .insert(user)
      .values({ id, name: "Integration test", email: `${id}@example.test`, emailVerified: true });
  });

export const deleteTestUser = (pool: Pool, id: string) =>
  capabilityOperation("testDatabase", "deleteUser", async () => {
    await createPostgresDrizzle(pool).delete(user).where(eq(user.id, id));
  });

/** Closing the pool is mandatory even when an unmigrated test database rejects cleanup. */
export const deleteTestUserAndClosePool = (pool: Pool, id: string) =>
  deleteTestUser(pool, id).pipe(Effect.ensuring(Effect.promise(() => pool.end())));
