// Minimal Bilaga HTTP client used by the MCP server. No dependencies.
import { statSync, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

const USER_AGENT = 'Bilaga-MCP/0.1';

export class BilagaError extends Error {
  constructor(status, body) {
    const code = body?.error?.code ?? 'http_error';
    const message = body?.error?.message ?? (typeof body === 'string' ? body : JSON.stringify(body));
    super(`Bilaga returned ${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BilagaClient {
  constructor({ base = 'https://bilaga.link', token, fetch: fetchImpl = globalThis.fetch } = {}) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  requireToken() {
    if (!this.token) {
      throw new Error(
        'BILAGA_TOKEN is not set. Create an agent token at https://bilaga.link/account and pass it as the BILAGA_TOKEN environment variable.',
      );
    }
  }

  async api(path, { method = 'GET', json, body, auth = true, retry = false } = {}) {
    if (auth) this.requireToken();
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
      payload = body;
    }
    const attempts = retry ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let res;
      try {
        res = await this.fetch(`${this.base}/api/${path}`, { method, headers, body: payload });
      } catch (err) {
        if (attempt < attempts - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      const text = await res.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (res.ok) return parsed;
      const retriable = res.status >= 500 || res.status === 429;
      if (retriable && attempt < attempts - 1) {
        const after = Number(res.headers.get('Retry-After') ?? '0');
        await sleep(res.status === 429 ? Math.min(60, Math.max(1, after)) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new BilagaError(res.status, parsed);
    }
    throw new Error('unreachable');
  }

  // Public (no token) endpoints.
  config() {
    return this.api('config', { auth: false });
  }
  receipt(publicId) {
    return this.api(`receipts/${encodeURIComponent(publicId)}`, { auth: false });
  }
  receiptsByHash(hash) {
    return this.api(`receipts?hash=${encodeURIComponent(hash)}`, { auth: false });
  }

  /**
   * Upload a local file, resuming an existing unfinished transfer when `resume` is given.
   * `onProgress(uploadedBytes, totalBytes)` is optional.
   */
  async sendFile({ path, to, inReplyTo, sender, priceCents, resume, onProgress }) {
    const abs = resolve(path);
    const size = statSync(abs).size;
    if (size <= 0) throw new Error('File is empty. Bilaga only accepts non-empty files.');
    let transfer;
    if (resume) {
      transfer = await this.api(`transfers/${encodeURIComponent(resume)}`);
      if (transfer.filename !== basename(abs) || transfer.size_bytes !== size) {
        throw new Error('Resume requires the same file name and size. Do not modify the file between attempts.');
      }
    } else {
      const create = { filename: basename(abs), size_bytes: size };
      if (to) create.to = to;
      if (inReplyTo) create.in_reply_to = inReplyTo;
      if (sender) create.sender = sender;
      if (priceCents !== undefined) create.price_cents = priceCents;
      transfer = await this.api('transfers', { method: 'POST', json: create });
    }
    if (transfer.status === 'complete') return transfer;

    const id = transfer.id;
    const partSize = transfer.part_size_bytes;
    const uploaded = new Set((transfer.parts ?? []).filter((p) => p.etag).map((p) => p.number));
    const fh = await open(abs, 'r');
    try {
      let number = 1;
      let offset = 0;
      while (offset < size) {
        const len = Math.min(partSize, size - offset);
        if (!uploaded.has(number)) {
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, offset);
          await this.api(`transfers/${id}/parts/${number}`, { method: 'PUT', body: buf, retry: true });
        }
        offset += len;
        number += 1;
        onProgress?.(offset, size);
      }
    } finally {
      await fh.close();
    }
    const result = await this.api(`transfers/${id}/complete`, { method: 'POST', retry: true });
    return { ...result, id };
  }

  /** Download an addressed transfer by public id to `outPath` (defaults to the served filename). */
  async downloadFile({ publicId, outPath, overwrite = false }) {
    this.requireToken();
    const res = await this.fetch(`${this.base}/api/download/${encodeURIComponent(publicId)}`, {
      headers: { 'User-Agent': USER_AGENT, Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      throw new BilagaError(res.status, parsed);
    }
    let name;
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/);
    if (star) name = decodeURIComponent(star[1]);
    const out = resolve(outPath ?? basename(name ?? publicId));
    const flags = overwrite ? 'w' : 'wx';
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const sink = createWriteStream(out, { flags });
    await pipeline(
      res.body,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          yield chunk;
        }
      },
      sink,
    );
    return { saved: out, size_bytes: sizeBytes, sha256: hash.digest('hex'), public_id: publicId };
  }
}

