import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

// playwright.config.ts permits this default only for an explicit local frontend origin.
const apiToken = process.env['TEST_API_TOKEN'] ?? 'local-development-only';
const authenticatedHeaders = { Authorization: `Bearer ${apiToken}` };

function readBlackboxId(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
    throw new Error('Blackbox response must contain a string id');
  }
  return value.id;
}

function parseBlackboxJson(text: string | null): unknown {
  if (text === null) throw new Error('Blackbox response text is missing');
  const value: unknown = JSON.parse(text);
  return value;
}

async function expectHttpStatus(pending: Promise<APIResponse>, status: number) {
  const response = await pending;
  expect(response.status()).toBe(status);
}

async function createBlackboxNote(request: APIRequestContext, content: string): Promise<string> {
  const response = await request.post('/api/notes', { headers: authenticatedHeaders, data: { content } });
  expect(response.status()).toBe(201);
  const note: unknown = await response.json();
  expect(note).toEqual(expect.objectContaining({ id: expect.any(String), content }));
  const id = readBlackboxId(note);
  expect(id).toMatch(/^[A-Za-z0-9_-]+$/u);
  return id;
}

test('frontend health and security headers', async ({ request }) => {
  const health = await request.get('/healthz');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual(expect.objectContaining({ status: 'ok', environment: expect.any(String) }));
  const frontend = await request.get('/');
  expect(frontend.status()).toBe(200);
  expect(frontend.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(frontend.headers()['x-content-type-options']).toBe('nosniff');
  expect(frontend.headers()['referrer-policy']).toBe('no-referrer');
});

test('real note storage and workflow produce uppercase content through the frontend', async ({ request }) => {
  const content = `Blackbox mixed Case ${randomUUID()}`;
  const noteId = await createBlackboxNote(request, content);
  const stored = await request.get(`/api/notes/${noteId}`, { headers: authenticatedHeaders });
  expect(stored.status()).toBe(200);
  expect(await stored.json()).toEqual(expect.objectContaining({ id: noteId, content }));

  const started = await request.post('/api/jobs', { headers: authenticatedHeaders, data: { noteId } });
  expect(started.status()).toBe(202);
  const job: unknown = await started.json();
  expect(job).toEqual(expect.objectContaining({ id: expect.any(String), noteId }));
  const jobId = readBlackboxId(job);
  expect(jobId).toMatch(/^[A-Za-z0-9_-]+$/u);
  await expect.poll(async () => {
    const response = await request.get(`/api/jobs/${jobId}`, { headers: authenticatedHeaders });
    expect([200, 202]).toContain(response.status());
    const result: unknown = await response.json();
    return result;
  }, { timeout: 90_000, intervals: [500, 1000, 2000], message: 'The real workflow must persist its completed uppercase result' }).toEqual(expect.objectContaining({
    id: jobId, noteId, status: 'completed', content: content.toUpperCase()
  }));
});

test('all authenticated routes reject missing and incorrect bearer credentials', async ({ request }) => {
  const noteId = randomUUID();
  await Promise.all([{}, { Authorization: `Bearer invalid-${randomUUID()}` }].map(async (headers) => {
    await Promise.all([
      expectHttpStatus(request.get(`/api/notes/${noteId}`, { headers }), 401),
      expectHttpStatus(request.get(`/api/jobs/${randomUUID()}`, { headers }), 401),
      expectHttpStatus(request.post('/api/notes', { headers, data: { content: 'Unauthorized note' } }), 401),
      expectHttpStatus(request.post('/api/jobs', { headers, data: { noteId } }), 401)
    ]);
  }));
});

test('invalid note and job inputs fail at the real API boundary', async ({ request }) => {
  await Promise.all([{}, { content: '' }, { content: '   ' }, { content: 42 }, { content: 'x'.repeat(4001) }].map((data) =>
    expectHttpStatus(request.post('/api/notes', { headers: authenticatedHeaders, data }), 400)));
  await Promise.all([{}, { noteId: '' }, { noteId: 42 }, { noteId: 'not-a-uuid' }].map((data) =>
    expectHttpStatus(request.post('/api/jobs', { headers: authenticatedHeaders, data }), 400)));
  const malformed = await request.post('/api/notes', { headers: { ...authenticatedHeaders, 'Content-Type': 'application/json' }, data: '{' });
  expect(malformed.status()).toBe(400);
  const wrongMedia = await request.post('/api/notes', { headers: { ...authenticatedHeaders, 'Content-Type': 'text/plain' }, data: 'hello' });
  expect(wrongMedia.status()).toBe(415);
  const missingNote = randomUUID();
  await expectHttpStatus(request.get(`/api/notes/${missingNote}`, { headers: authenticatedHeaders }), 404);
  await expectHttpStatus(request.post('/api/jobs', { headers: authenticatedHeaders, data: { noteId: missingNote } }), 404);
});

test('developer UI creates and reads a note, completes a workflow, and clears the token on reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#health')).toHaveText('API healthy');
  await expect(page.locator('#environment')).not.toHaveText(/unknown|not reported/u);
  const content = `UI mixed Case ${randomUUID()} <b>plain text</b>`;
  await page.getByLabel('Note content', { exact: true }).fill(content);
  await page.getByRole('button', { name: 'Create note' }).click();
  await expect(page.locator('#note-result')).toHaveText('Enter a bearer token to call the API.');
  await page.getByLabel('Bearer token', { exact: true }).fill(apiToken);
  await page.getByRole('button', { name: 'Create note' }).click();
  await expect(page.locator('#note-result')).toHaveAttribute('data-state', 'ok');
  const noteId = await page.getByLabel('Note ID', { exact: true }).inputValue();
  expect(noteId).toMatch(/^[A-Za-z0-9_-]+$/u);
  await expect(page.getByLabel('Note ID to process', { exact: true })).toHaveValue(noteId);
  expect(parseBlackboxJson(await page.locator('#note-result').textContent())).toEqual(expect.objectContaining({ id: noteId, content }));
  await expect(page.locator('#note-result b')).toHaveCount(0);

  // Require the read HTTP response so a stale create result cannot satisfy the test.
  const readResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/notes/${noteId}` && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Read note', exact: true }).click();
  const readResult = await readResponse;
  expect(readResult.status()).toBe(200);
  await expect(page.locator('#note-result')).toHaveAttribute('data-state', 'ok');
  expect(parseBlackboxJson(await page.locator('#note-result').textContent())).toEqual(expect.objectContaining({ id: noteId, content }));
  await page.getByRole('button', { name: 'Start workflow' }).click();
  await expect(page.locator('#job-result')).toHaveAttribute('data-state', 'ok');
  const jobId = await page.getByLabel('Job ID', { exact: true }).inputValue();
  expect(jobId).toMatch(/^[A-Za-z0-9_-]+$/u);
  await expect.poll(async () => {
    const statusResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/jobs/${jobId}` && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    const statusResult = await statusResponse;
    expect([200, 202]).toContain(statusResult.status());
    await expect(page.locator('#job-result')).toHaveAttribute('data-state', 'ok');
    return parseBlackboxJson(await page.locator('#job-result').textContent());
  }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toEqual(expect.objectContaining({ id: jobId, noteId, status: 'completed', content: content.toUpperCase() }));
  await expect(page.locator('#job-status')).toHaveText('· completed');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByLabel('Bearer token', { exact: true })).toHaveValue('');
});
