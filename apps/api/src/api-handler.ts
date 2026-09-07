import { Effect, Schema } from 'effect';
import { Database, ObjectStore, Queue } from '@factory/platform';

const createNoteSchema = Schema.Struct({ content: Schema.String });
const createJobSchema = Schema.Struct({ noteId: Schema.String });
const responseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const jsonResponse = (value: unknown, status = 200) => Response.json(value, {status, headers: responseHeaders});
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/u;

/** API request configuration contains only runtime credentials, never provisioning tokens. */
export interface ApiConfiguration { readonly token: string; readonly environment: 'dev' | 'preview' | 'prod' }

/** One handler serves both Workers and Node; authentication precedes every data operation. */
export const handleApiRequest = (request: Request, config: ApiConfiguration) => Effect.gen(function* () {
  const url = new URL(request.url);
  if (url.pathname === '/healthz' && request.method === 'GET') return jsonResponse({status:'ok', environment:config.environment});
  if (config.token.length < 20) return jsonResponse({error:'Service not configured'},503);
  if (request.headers.get('authorization') !== `Bearer ${config.token}`) return jsonResponse({error:'Unauthorized'},401);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse({error:'Method not allowed'},405);
  const database = yield* Database;
  const objects = yield* ObjectStore;
  if (request.method === 'GET') {
    const id = url.pathname.split('/')[3] ?? '';
    if (!uuidPattern.test(id)) return jsonResponse({error:'Not found'},404);
    if (url.pathname === `/api/notes/${id}`) {
      const note = yield* database.getNote(id);
      return note === null ? jsonResponse({error:'Not found'},404) : jsonResponse({...note,content:note.text});
    }
    if (url.pathname === `/api/jobs/${id}`) {
      const result = yield* objects.get(`job/${id}.json`);
      if (result === null) return jsonResponse({id,status:'pending'},202);
      return new Response(new TextDecoder().decode(result), {headers:{...responseHeaders,'content-type':'application/json'}});
    }
    return jsonResponse({error:'Not found'},404);
  }
  if (request.headers.get('content-type')?.startsWith('application/json') !== true) return jsonResponse({error:'JSON required'},415);
  const body = yield* Effect.tryPromise(async () => {
    const reader = request.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new Error('API request body must contain bytes');
      size += chunk.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new Error('API request body exceeds limit'); }
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(result);
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (body === null) return jsonResponse({error:'Request body too large'},413);
  const parsed = yield* Effect.try(():unknown => JSON.parse(body)).pipe(Effect.catch(() => Effect.succeed(null)));
  if (url.pathname === '/api/notes') {
    const input = yield* Schema.decodeUnknownEffect(createNoteSchema)(parsed).pipe(Effect.catch(() => Effect.succeed(null)));
    if (input === null || input.content.trim().length === 0 || input.content.length > 4000) return jsonResponse({error:'Content must contain 1–4000 characters'},400);
    const note = {id:crypto.randomUUID(),text:input.content,createdAt:new Date().toISOString()};
    yield* database.createNote(note);
    return jsonResponse({...note,content:note.text},201);
  }
  if (url.pathname === '/api/jobs') {
    const input = yield* Schema.decodeUnknownEffect(createJobSchema)(parsed).pipe(Effect.catch(() => Effect.succeed(null)));
    if (input === null || !uuidPattern.test(input.noteId)) return jsonResponse({error:'Valid noteId required'},400);
    const note = yield* database.getNote(input.noteId);
    if (note === null) return jsonResponse({error:'Note not found'},404);
    const job = {id:crypto.randomUUID(),noteId:input.noteId};
    const queue = yield* Queue;
    yield* queue.enqueue(job);
    return jsonResponse({...job,status:'pending'},202);
  }
  return jsonResponse({error:'Not found'},404);
}).pipe(Effect.orElseSucceed(() => jsonResponse({error:'Provider unavailable'},503)));
