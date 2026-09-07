import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigProvider, Effect } from 'effect';
import { parseApiConfiguration } from './api-configuration.js';
import { parsePortableConfiguration } from './portable-configuration.js';

const portableEnvironment = {
  ENVIRONMENT:'dev', DATABASE_URL:'postgres://factory:secret@postgres:5432/factory',
  REDIS_URL:'redis://redis:6379', S3_ENDPOINT:'http://minio:9000',
  S3_ACCESS_KEY_ID:'test-access', S3_SECRET_ACCESS_KEY:'test-secret', S3_BUCKET:'factory',
  SMTP_HOST:'mailpit', SMTP_PORT:'1025', TEMPORAL_ADDRESS:'temporal:7233',
  TEMPORAL_NAMESPACE:'default', TEMPORAL_TASK_QUEUE:'factory-notes', PLATFORM_NAMESPACE:'factory',
};

test('API scalar boundary accepts uniform environments and rejects missing secrets without leaking values', () => {
  for (const environment of ['dev','preview','prod']) {
    const parsed = Effect.runSync(parseApiConfiguration(ConfigProvider.fromEnvRecord({ENVIRONMENT:environment,API_TOKEN:'synthetic-test-token-long-enough'})));
    assert.equal(parsed.environment, environment);
  }
  for (const bindings of [{ENVIRONMENT:'local',API_TOKEN:'synthetic-test-token-long-enough'}, {ENVIRONMENT:'prod',API_TOKEN:'local-development-only'}, {ENVIRONMENT:'dev',API_TOKEN:'short-secret'}, {ENVIRONMENT:'dev'}]) {
    const error = Effect.runSync(parseApiConfiguration(ConfigProvider.fromEnvRecord(bindings)).pipe(Effect.flip));
    assert.ok(error.message.includes('Invalid API environment'));
    assert.ok(!error.message.includes('short-secret'));
  }
});

test('portable boundary parses numeric ports and explicit isolated namespaces', () => {
  const parsed = Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnvRecord(portableEnvironment)));
  assert.equal(parsed.smtpPort,1025);
  assert.equal(parsed.namespace,'factory');
  assert.equal(parsed.temporalNamespace,'default');
  assert.equal(parsed.taskQueue,'factory-notes');
});

test('portable boundary rejects invalid endpoints, missing isolation and malformed ports before connecting', () => {
  const invalidSettings = [
    {DATABASE_URL:'https://postgres/factory'}, {REDIS_URL:'file:///redis'},
    {S3_ENDPOINT:'http://username:secret@minio:9000'}, {S3_ENDPOINT:'http://minio:9000?secret=hidden'},
    {SMTP_PORT:'0'}, {SMTP_PORT:'65536'}, {SMTP_PORT:'1.5'}, {SMTP_PORT:'abc'},
    {TEMPORAL_ADDRESS:'temporal'}, {TEMPORAL_NAMESPACE:''}, {TEMPORAL_TASK_QUEUE:''},
    {PLATFORM_NAMESPACE:''}, {S3_SECRET_ACCESS_KEY:''}, {ENVIRONMENT:'local'},
  ];
  for (const invalidSetting of invalidSettings) {
    assert.throws(() => Effect.runSync(parsePortableConfiguration(ConfigProvider.fromEnvRecord({...portableEnvironment,...invalidSetting}))), /Invalid portable environment/u);
  }
});
