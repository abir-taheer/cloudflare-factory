import { z } from "zod";

const PublicOperationSchema = z.looseObject({ servers: z.never().optional() });
const operation = PublicOperationSchema.optional();

const PublicPathSchema = PublicOperationSchema.extend({
  get: operation,
  put: operation,
  post: operation,
  delete: operation,
  options: operation,
  head: operation,
  patch: operation,
  trace: operation,
});

/** Privacy boundary preserves OpenAPI fields while rejecting deployment-specific server URLs. */
export const PublicOpenApiSchema = PublicOperationSchema.extend({
  openapi: z.string().regex(/^3\.1\.\d+$/u),
  info: z.looseObject({ title: z.string(), version: z.string() }),
  paths: z.record(z.string().startsWith("/"), PublicPathSchema),
  components: z.looseObject({ schemas: z.record(z.string(), z.unknown()) }),
});
