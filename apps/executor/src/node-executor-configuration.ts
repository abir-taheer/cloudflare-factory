import { Data, Effect } from "effect";
import { z } from "zod";

/** Invalid executor configuration excludes credential values and parser causes. */
export class ExecutorConfigurationError extends Data.TaggedError("ExecutorConfigurationError")<
  Record<never, never>
> {}

const executorTokenMinimumLength = 20;

const ExecutorEnvironmentSchema = z
  .object({
    ENVIRONMENT: z.enum(["dev", "preview", "prod"]),
    EXECUTOR_TOKEN: z.string().min(executorTokenMinimumLength).regex(/^\S+$/u),
  })
  .refine(
    (value) =>
      value.ENVIRONMENT === "dev" || value.EXECUTOR_TOKEN !== "local-executor-development-only",
  );

/** Validate executor scalars without retaining invalid input in the failure. */
export const parseExecutorConfiguration = (input: unknown) =>
  Effect.suspend(() => {
    const result = ExecutorEnvironmentSchema.safeParse(input);

    if (!result.success) {
      return Effect.fail(new ExecutorConfigurationError());
    }

    return Effect.succeed(result.data);
  });

/** Configuration is read once at the Node process boundary, without credential fallbacks. */
export const readExecutorConfiguration = () =>
  Effect.runSync(parseExecutorConfiguration(process.env));
