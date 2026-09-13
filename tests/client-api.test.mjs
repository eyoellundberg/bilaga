import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, retryRequest, uploadChunks } from '../lib/client-api.ts';
import { sha256 } from '../lib/hash.ts';

test('authentication failures are not retried, and tokens cannot follow redirects', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('Authorization'), 'Bearer example');
    return Response.json(
      { error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  });
  await assert.rejects(
    retryRequest(
      () => request('/api/transfers', ' example '),
      new AbortController().signal,
    ),
    /Unauthorized/,
  );
  assert.equal(calls, 1);
});

test('transient HTTP failure retries the same request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1
      ? new Response('Temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        })
      : Response.json({ ok: true }),
  );
  assert.deepEqual(
    await retryRequest(
      () =>
        request('/api/transfers/id/parts/1', 'example', {
          method: 'PUT',
          body: new Blob(['x']),
        }),
      new AbortController().signal,
    ),
    { ok: true },
  );
  assert.equal(calls, 2);
});

test('Retry-After wait is respected and cancellation stops further attempts', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({}, { status: 429, headers: { 'Retry-After': '60' } });
  });
  const pending = retryRequest(
    () => request('/api/transfers/id/parts/1', 'example'),
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('multipart slicing preserves bytes and reserves 100% for completion', async () => {
  const chunks = [],
    progress = [];
  await uploadChunks(
    new Blob(['abcdefghij']),
    4,
    new AbortController().signal,
    async (part, chunk) => chunks.push([part, await chunk.text()]),
    (value) => progress.push(value),
  );
  assert.deepEqual(chunks, [
    [1, 'abcd'],
    [2, 'efgh'],
    [3, 'ij'],
  ]);
  assert.deepEqual(progress, [40, 80, 99]);
  await assert.rejects(
    uploadChunks(
      new Blob(['x']),
      0,
      new AbortController().signal,
      async () => {},
      () => {},
    ),
    /Invalid/,
  );
});

test('shared hash matches the SHA-256 known answer', async () => {
  assert.equal(
    await sha256(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
