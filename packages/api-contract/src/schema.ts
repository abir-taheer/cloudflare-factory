import { z } from "@hono/zod-openapi";

const maximumNoteContentLength = 4000;

/** Public resource ID format shared by route validation and generated clients. */
export const ApiIdSchema = z
  .string()
  .regex(/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/u)
  .openapi("ApiId");

/** Resource path parameter schema. */
export const ApiIdParamsSchema = z.object({ id: ApiIdSchema });

/** Public error envelope contains no provider diagnostics. */
export const ApiErrorSchema = z
  .object({ error: z.string(), code: z.string(), requestId: z.string(), retryable: z.boolean() })
  .openapi("ApiError");

/** Persisted note response retains text for storage compatibility and content for UI clients. */
export const ApiNoteSchema = z
  .object({ id: ApiIdSchema, text: z.string(), content: z.string(), createdAt: z.string() })
  .openapi("ApiNote");

/** Note content must contain visible text and fit the public size limit. */
export const CreateNoteSchema = z
  .object({
    content: z
      .string()
      .max(maximumNoteContentLength)
      .refine((value) => value.trim().length > 0),
  })
  .openapi("CreateNote");

/** Workflow requests reference an existing note. */
export const CreateJobSchema = z.object({ noteId: ApiIdSchema }).openapi("CreateJob");

/** Accepted workflow response identifies the queued note. */
export const AcceptedJobSchema = z
  .object({ id: ApiIdSchema, noteId: CreateJobSchema.shape.noteId, status: z.literal("pending") })
  .openapi("AcceptedJob");

/** Pending workflow response is safe to poll. */
export const PendingJobSchema = AcceptedJobSchema.omit({ noteId: true }).openapi("PendingJob");

/** Completed workflow result exposes the transformed content. */
export const CompletedJobSchema = AcceptedJobSchema.omit({ status: true })
  .extend({
    status: z.literal("completed"),
    content: z.string(),
  })
  .openapi("CompletedJob");

/** Health exposes only the deployment category, never provider configuration. */
export const ApiHealthSchema = z
  .object({ status: z.literal("ok"), environment: z.enum(["dev", "preview", "prod"]) })
  .openapi("ApiHealth");
