import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect, Schedule } from "effect";
import {
  ExecutorConfigurationError,
  parseExecutorConfiguration,
} from "./node-executor-configuration.js";

const expectedStatus = {
  ok: 200,
  unauthorized: 401,
  invalid: 400,
  tooLarge: 413,
  timeout: 408,
  busy: 429,
};

const oversizedBodyCharacters = 17_000;
const excessiveTimeoutMs = 30_001;
const childTerminationTimeoutMs = 100;
const childObservationDelayMs = 700;

const token = "local-executor-development-only";
const executorPath = fileURLToPath(new URL("node-executor.ts", import.meta.url));
const endpoint = "http://127.0.0.1:8090/execute";
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const execute = (command: string, timeoutMs = 2000) =>
  fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ command, timeoutMs }),
  });

const expectResponseStatus = async (pending: Promise<Response>, status: number) => {
  const response = await pending;
  assert.equal(response.status, status);
};

const readExecution = async (response: Response): Promise<unknown> => response.json();

test("executor startup rejects absent and invalid scalar configuration without leaking tokens", async () => {
  for (const environment of [
    { ENVIRONMENT: "dev" },
    { ENVIRONMENT: "local", EXECUTOR_TOKEN: token },
    { ENVIRONMENT: "prod", EXECUTOR_TOKEN: token },
    { ENVIRONMENT: "dev", EXECUTOR_TOKEN: "secret with spaces" },
  ]) {
    const error = Effect.runSync(parseExecutorConfiguration(environment).pipe(Effect.flip));

    assert.ok(error instanceof ExecutorConfigurationError);
    assert.equal("cause" in error, false);
  }

  const child = spawn(process.execPath, ["--import", "tsx", executorPath], {
    env: { ENVIRONMENT: "dev" },
    stdio: "ignore",
  });

  const exit = await once(child, "exit");
  assert.deepEqual(exit, [1, null]);
});

test("real executor bounds requests, output and child lifetime while preserving command results", async (context) => {
  const child = spawn(process.execPath, ["--import", "tsx", executorPath], {
    env: { ENVIRONMENT: "dev", EXECUTOR_TOKEN: token },
    stdio: "ignore",
  });

  context.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
  });

  await Effect.runPromise(
    Effect.tryPromise(() => fetch(endpoint)).pipe(
      Effect.retry({ times: 50, schedule: Schedule.spaced("100 millis") }),
    ),
  );

  await expectResponseStatus(fetch(endpoint), expectedStatus.unauthorized);

  const response = await execute("printf hello; printf error >&2; exit 7");
  const result = await readExecution(response);

  assert.deepEqual(result, { stdout: "hello", stderr: "error", exitCode: 7 });
  await expectResponseStatus(execute("x".repeat(oversizedBodyCharacters)), expectedStatus.tooLarge);
  await expectResponseStatus(execute("true", excessiveTimeoutMs), expectedStatus.invalid);
  await expectResponseStatus(execute("yes output"), expectedStatus.timeout);

  const marker = `/tmp/executor-child-${randomUUID()}`;

  await expectResponseStatus(
    execute(`(sleep 0.5; touch ${marker}) & wait`, childTerminationTimeoutMs),
    expectedStatus.timeout,
  );

  await delay(childObservationDelayMs);

  const timeoutResponse = await execute(`test ! -e ${marker}`);
  const timeoutResult = await readExecution(timeoutResponse);
  assert.deepEqual(timeoutResult, { stdout: "", stderr: "", exitCode: 0 });

  const pending = execute("sleep 0.3");

  await delay(childTerminationTimeoutMs);
  await expectResponseStatus(execute("true"), expectedStatus.busy);
  await expectResponseStatus(pending, expectedStatus.ok);

  const abort = new AbortController();

  const abortedRequest = fetch(endpoint, {
    method: "POST",
    headers,
    signal: abort.signal,
    body: JSON.stringify({ command: `(sleep 0.5; touch ${marker}) & wait`, timeoutMs: 30_000 }),
  });

  const disconnected = assert.rejects(abortedRequest);

  await delay(childTerminationTimeoutMs);
  abort.abort();
  await disconnected;
  await delay(childObservationDelayMs);

  const disconnectResponse = await execute(`test ! -e ${marker}`);
  const disconnectResult = await readExecution(disconnectResponse);

  assert.deepEqual(disconnectResult, { stdout: "", stderr: "", exitCode: 0 });
  await expectResponseStatus(execute(`(sleep 0.5; touch ${marker}) &`), expectedStatus.ok);
  await delay(childObservationDelayMs);

  const backgroundResponse = await execute(`test ! -e ${marker}`);
  const backgroundResult = await readExecution(backgroundResponse);
  assert.deepEqual(backgroundResult, { stdout: "", stderr: "", exitCode: 0 });
});
