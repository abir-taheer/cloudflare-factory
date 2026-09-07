import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfigProvider, Effect, Schedule } from 'effect';
import { parseExecutorConfiguration } from './node-executor-configuration.js';

const token = 'local-executor-development-only';
const executorPath = fileURLToPath(new URL('node-executor.ts', import.meta.url));
const endpoint = 'http://127.0.0.1:8090/execute';
const headers = {authorization:`Bearer ${token}`,'content-type':'application/json'};
const execute = (command: string, timeoutMs = 2000) => fetch(endpoint, {
  method:'POST', headers, body:JSON.stringify({command,timeoutMs}),
});
const expectResponseStatus = async (pending: Promise<Response>, status: number) => {
  const response = await pending;
  assert.equal(response.status,status);
};
const readExecution = async (response: Response): Promise<unknown> => response.json();

test('executor startup rejects absent and invalid scalar configuration without leaking tokens', async () => {
  for (const environment of [
    {ENVIRONMENT:'dev'}, {ENVIRONMENT:'local',EXECUTOR_TOKEN:token},
    {ENVIRONMENT:'prod',EXECUTOR_TOKEN:token}, {ENVIRONMENT:'dev',EXECUTOR_TOKEN:'secret with spaces'},
  ]) {
    const error = Effect.runSync(parseExecutorConfiguration(ConfigProvider.fromEnvRecord(environment)).pipe(Effect.flip));
    assert.ok(error.message.includes('Invalid executor environment'));
    assert.ok(!error.message.includes('secret with spaces'));
  }
  const child = spawn(process.execPath, ['--import','tsx',executorPath], {env:{ENVIRONMENT:'dev'},stdio:'ignore'});
  assert.deepEqual(await once(child,'exit'), [1,null]);
});

test('real executor bounds requests, output and child lifetime while preserving command results', async (context) => {
  const child = spawn(process.execPath, ['--import','tsx',executorPath], {env:{ENVIRONMENT:'dev',EXECUTOR_TOKEN:token},stdio:'ignore'});
  context.after(async () => { child.kill('SIGTERM'); await once(child,'exit'); });
  await Effect.runPromise(Effect.tryPromise(() => fetch(endpoint)).pipe(
    Effect.retry({times:50,schedule:Schedule.spaced('100 millis')}),
  ));
  await expectResponseStatus(fetch(endpoint),401);
  assert.deepEqual(await readExecution(await execute('printf hello; printf error >&2; exit 7')), {stdout:'hello',stderr:'error',exitCode:7});
  await expectResponseStatus(execute('x'.repeat(17_000)),413);
  await expectResponseStatus(execute('true',30_001),400);
  await expectResponseStatus(execute('yes output'),408);
  const marker = `/tmp/executor-child-${randomUUID()}`;
  await expectResponseStatus(execute(`(sleep 0.5; touch ${marker}) & wait`,100),408);
  await delay(700);
  assert.deepEqual(await readExecution(await execute(`test ! -e ${marker}`)), {stdout:'',stderr:'',exitCode:0});
  const pending = execute('sleep 0.3');
  await delay(100);
  await expectResponseStatus(execute('true'),429);
  await expectResponseStatus(pending,200);
  const abort = new AbortController();
  const abortedRequest = fetch(endpoint, {
    method:'POST',headers,signal:abort.signal,
    body:JSON.stringify({command:`(sleep 0.5; touch ${marker}) & wait`,timeoutMs:30_000}),
  });
  const disconnected = assert.rejects(abortedRequest);
  await delay(100);
  abort.abort();
  await disconnected;
  await delay(700);
  assert.deepEqual(await readExecution(await execute(`test ! -e ${marker}`)), {stdout:'',stderr:'',exitCode:0});
  await expectResponseStatus(execute(`(sleep 0.5; touch ${marker}) &`),200);
  await delay(700);
  assert.deepEqual(await readExecution(await execute(`test ! -e ${marker}`)), {stdout:'',stderr:'',exitCode:0});
});
