import type { z } from "zod";

/** Validate provider values; adapters translate validation failures into typed capability errors. */
export function parsePlatformValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

/** Bind a provider schema once for repeated boundary validation. */
export function makePlatformDecoder<T>(schema: z.ZodType<T>) {
  return (value: unknown): T => parsePlatformValue(schema, value);
}
