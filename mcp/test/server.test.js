import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BilagaClient } from '../src/client.js';
import { createServer } from '../src/index.js';

const PART = 1024; // small part size so the test file needs several parts

function fakeBilaga() {
  const state = { transfers: new Map(), calls: [], failFirstPart: false };
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    state.calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, ua: req.headers['user-agent'] });
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const m = url.pathname.match(/^\/api\/(.*)$/);
    const path = m?.[1] ?? '';
    if (path === 'config') return json(200, { part_size_bytes: PART, max_file_bytes: 1e6 });
    if (req.headers.authorization !== 'Bearer tok') return json(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (path === 'transfers' && req.method === 'POST') {
      const create = JSON.parse(body.toString());
      const id = `tr_${state.transfers.size + 1}`;
      state.transfers.set(id, { id, ...create, status: 'uploading', part_size_bytes: PART, parts: [], data: [] });
      return json(200, state.transfers.get(id));
    }
    let pm;
    if ((pm = path.match(/^transfers\/([^/]+)\/parts\/(\d+)$/)) && req.method === 'PUT') {
      const t = state.transfers.get(pm[1]);
      const n = Number(pm[2]);
      if (state.failFirstPart && n === 1 && !t.failed) {
        t.failed = true;
        return json(503, { error: { code: 'flaky', message: 'try again' } });
      }
      t.data[n - 1] = body;
      t.parts.push({ number: n, etag: `e${n}` });
      return json(200, { number: n });
    }
    if ((pm = path.match(/^transfers\/([^/]+)\/complete$/)) && req.method === 'POST') {
      const t = state.transfers.get(pm[1]);
      t.status = 'complete';
      t.share_url = `https://bilaga.link/t/pub_${t.id}`;
      return json(200, { status: 'complete', share_url: t.share_url, charged_usd: 0, billing: 'free_allowance' });
    }
    if ((pm = path.match(/^transfers\/([^/]+)$/)) && req.method === 'GET') {
      const t = state.transfers.get(pm[1]);
      if (!t) return json(404, { error: { code: 'not_found', message: 'no' } });
      const { data, ...rest } = t;
      return json(200, rest);
    }
    if (path === 'balance') return json(200, { balance_cents: 1234, ledger: [] });
    if (path.startsWith('download/')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''hello%20world.bin" });
      return res.end(Buffer.from('downloaded bytes'));
    }
    return json(404, { error: { code: 'not_found', message: path } });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

async function connect(base, token = 'tok') {
  const bilaga = new BilagaClient({ base, token });
  const mcp = createServer(bilaga);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return { client, close: () => Promise.all([client.close(), mcp.close()]) };
}

test('send_file uploads all parts, retries a flaky part, and returns share_url', async () => {
  const { server, state, base } = await fakeBilaga();
  state.failFirstPart = true;
  const dir = mkdtempSync(join(tmpdir(), 'bilaga-'));
  const file = join(dir, 'report.bin');
  const bytes = Buffer.alloc(PART * 2 + 100, 7);
  writeFileSync(file, bytes);
  const { client, close } = await connect(base);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === 'send_file'));
    const res = await client.callTool({ name: 'send_file', arguments: { path: file, to: 'a@b.co' } });
    assert.equal(res.isError, undefined);
    assert.equal(res.structuredContent.share_url, 'https://bilaga.link/t/pub_tr_1');
    assert.equal(res.structuredContent.id, 'tr_1');
    const t = state.transfers.get('tr_1');
    assert.equal(t.to, 'a@b.co');
    assert.deepEqual(t.parts.map((p) => p.number), [1, 2, 3]);
    assert.ok(Buffer.concat(t.data).equals(bytes), 'server received identical bytes');
    assert.equal(state.calls.every((c) => c.ua === 'Bilaga-MCP/0.1'), true);
    assert.equal(state.calls.filter((c) => c.path.endsWith('/parts/1')).length, 2, 'part 1 retried after 503');
  } finally {
    await close();
    server.close();
  }
});

test('send_file resumes and skips already uploaded parts', async () => {
  const { server, state, base } = await fakeBilaga();
  const dir = mkdtempSync(join(tmpdir(), 'bilaga-'));
  const file = join(dir, 'big.bin');
  writeFileSync(file, Buffer.alloc(PART * 3, 1));
  state.transfers.set('tr_9', { id: 'tr_9', filename: 'big.bin', size_bytes: PART * 3, status: 'uploading', part_size_bytes: PART, parts: [{ number: 1, etag: 'x' }, { number: 2, etag: 'y' }], data: [] });
  const { client, close } = await connect(base);
  try {
    const res = await client.callTool({ name: 'send_file', arguments: { path: file, resume: 'tr_9' } });
    assert.equal(res.isError, undefined);
    assert.deepEqual(state.calls.filter((c) => c.method === 'PUT').map((c) => c.path), ['/api/transfers/tr_9/parts/3']);
  } finally {
    await close();
    server.close();
  }
});

test('API errors come back as isError with code, not as thrown protocol errors', async () => {
  const { server, base } = await fakeBilaga();
  const { client, close } = await connect(base, 'wrong');
  try {
    const res = await client.callTool({ name: 'get_balance', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /401 unauthorized/);
    assert.equal(res.structuredContent.code, 'unauthorized');
  } finally {
    await close();
    server.close();
  }
});

test('download_file saves the served filename and hashes it', async () => {
  const { server, base } = await fakeBilaga();
  const dir = mkdtempSync(join(tmpdir(), 'bilaga-'));
  const { client, close } = await connect(base);
  try {
    const res = await client.callTool({ name: 'download_file', arguments: { public_id: 'pub_1', out_path: join(dir, 'x.bin') } });
    assert.equal(res.isError, undefined);
    assert.equal(readFileSync(res.structuredContent.saved, 'utf8'), 'downloaded bytes');
    assert.equal(res.structuredContent.size_bytes, 16);
    const again = await client.callTool({ name: 'download_file', arguments: { public_id: 'pub_1', out_path: join(dir, 'x.bin') } });
    assert.equal(again.isError, true, 'refuses to overwrite by default');
  } finally {
    await close();
    server.close();
  }
});

test('public tools work without a token; private ones explain how to get one', async () => {
  const { server, base } = await fakeBilaga();
  const { client, close } = await connect(base, null);
  try {
    const cfg = await client.callTool({ name: 'get_config', arguments: {} });
    assert.equal(cfg.structuredContent.part_size_bytes, PART);
    const bal = await client.callTool({ name: 'get_balance', arguments: {} });
    assert.equal(bal.isError, true);
    assert.match(bal.content[0].text, /BILAGA_TOKEN/);
  } finally {
    await close();
    server.close();
  }
});
