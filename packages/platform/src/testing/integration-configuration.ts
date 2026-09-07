import { ConfigProvider, Effect } from "effect";

/** Read only declared Docker integration settings; absent flags keep provider tests disabled. */
export const readIntegrationConfiguration = Effect.fn("platform.test.configuration")(function* (
  keys: readonly string[],
) {
  const provider = ConfigProvider.fromEnv();
  const values: Record<string, string | undefined> = {};

  for (const key of keys) {
    const node = yield* provider.load([key]);
    values[key] = node?.value;
  }

  return values;
});
