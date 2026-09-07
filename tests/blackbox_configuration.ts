import { z } from "zod";
import { PublicApiOriginSchema } from "../apps/frontend/src/lib/runtime_schema.js";

const LocalOriginSchema = PublicApiOriginSchema.refine(
  (value) => new URL(value).hostname === "localhost",
  "Synthetic accounts are permitted only against the local Docker stack",
);

const BlackboxConfigurationSchema = z.object({
  BASE_URL: LocalOriginSchema.default("http://localhost:5174"),
  API_URL: LocalOriginSchema.default("http://localhost:8787"),
  MAILPIT_URL: PublicApiOriginSchema.default("http://mailpit:8025"),
  ENVIRONMENT: z.literal("dev").default("dev"),
  CI: z.string().optional(),
});

/** One schema validates runner and test inputs before creating any synthetic accounts. */
export const blackboxConfiguration = BlackboxConfigurationSchema.parse(process.env);
