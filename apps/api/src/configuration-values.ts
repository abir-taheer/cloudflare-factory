import { type ConfigProvider, Effect } from "effect";

/** Load only declared scalar settings; validation owns missing-value and redaction policy. */
export const loadConfigurationValues = (
  provider: ConfigProvider.ConfigProvider,
  keys: readonly string[],
) =>
  Effect.gen(function* () {
    const values: Record<string, string | undefined> = {};

    for (const key of keys) {
      const node = yield* provider.load([key]);
      values[key] = node?.value;
    }

    return values;
  });
