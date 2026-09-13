import { json, fail, ApiError, bodyJson, boundedBody } from './http';
import { accountRoutes, tokenOwner, cleanAccounts } from './accounts';
export { json } from './http';
import { sha256 } from './hash';
import { env } from 'cloudflare:workers';
import {
  MAX_BYTES,
  PART_BYTES,
  RETENTION,
  DAY,
  MAX_STORED_BYTES,
  MAX_PENDING_UPLOADS,
  MAX_DAILY_TRANSFERS,
  quoteCents,
  validSize,
  cleanFilename,
  contentDisposition,
} from './rules';

type Transfer = {
  id: string;
  public_id: string;
  owner: string;
  filename: string;
  size: number;
  sender: string | null;
  upload_id: string | null;
  state: string;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
  sent_at: number | null;
  download_requests: number;
  last_download_at: number | null;
  purged_at: number | null;
  completion_lock_until: number;
};
type Part = {
  number: number;
  etag: string;
  size: number;
  content_hash: string | null;
};
// This is a per-isolate memory guard, not an account or persistent quota.
let activeChunkRequests = 0;
const bindings = () =>
  env as unknown as {
    DB: D1Database;
    FILES: R2Bucket;
    BILAGA_TOKEN_HASH?: string;
  };
const db = () => bindings().DB;
const bucket = () => bindings().FILES;
const key = (t: Transfer) => `transfers/${t.id}`;
const iso = (n: number | null) => (n ? new Date(n).toISOString() : null);
async function authorize(req: Request) {
  const token = req.headers
    .get('Authorization')
    ?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token || token.length > 256)
    return fail(401, 'unauthorized', 'A valid Bilaga token is required.');
  const actual = await sha256(new TextEncoder().encode(token));
  const expected = bindings().BILAGA_TOKEN_HASH;
  if (expected && actual === expected) return actual;
  const owner = await tokenOwner(actual);
  if (!owner)
    return fail(401, 'unauthorized', 'A valid Bilaga token is required.');
  return owner;
}
async function rateLimit(scope: string, limit: number) {
  const now = Date.now(),
    reset = now + 60_000;
  const row = await db()
    .prepare(`INSERT INTO rate_limits (scope,hits,reset_at) VALUES (?,1,?)
    ON CONFLICT(scope) DO UPDATE SET hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,
    reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
    WHERE reset_at<=? OR hits<? RETURNING hits`)
    .bind(scope, reset, now, now, now, limit)
    .first();
  if (!row)
    return fail(
      429,
      'rate_limited',
      'Too many requests. Wait a minute before retrying.',
    );
}
async function owned(id: string, owner: string) {
  const t = await db()
    .prepare('SELECT * FROM transfers WHERE id=? AND owner=?')
    .bind(id, owner)
    .first<Transfer>();
  if (!t) return fail(404, 'not_found', 'Transfer not found.');
  return t;
}
async function uploadParts(t: Transfer) {
  return (
    await db()
      .prepare(
        'SELECT number,etag,size,content_hash FROM parts WHERE transfer_id=? ORDER BY number',
      )
      .bind(t.id)
      .all<Part>()
  ).results;
}
function publicData(t: Transfer) {
  return {
    filename: t.filename,
    size_bytes: t.size,
    sender: t.sender,
    expires_at: iso(t.expires_at),
    status:
      t.state === 'deleted'
        ? 'deleted'
        : t.expires_at <= Date.now()
          ? 'expired'
          : t.state,
  };
}
function privateData(t: Transfer, origin: string) {
  return {
    id: t.id,
    ...publicData(t),
    created_at: iso(t.created_at),
    completed_at: iso(t.completed_at),
    sent_at: iso(t.sent_at),
    download_requests: t.download_requests,
    last_download_requested_at: iso(t.last_download_at),
    download_note:
      'Requests indicate a download was started, not completed or read.',
    share_url: t.state === 'complete' ? `${origin}/t/${t.public_id}` : null,
    estimated_price_usd: quoteCents(t.size) / 100,
    charged_usd: 0,
    billing: 'preview_no_charge',
    part_size_bytes: PART_BYTES,
  };
}
async function removeBytes(t: Transfer) {
  // Revoke and redact first. A storage outage must not leave the link accessible.
  await db()
    .prepare(
      "UPDATE transfers SET state='deleted',filename='Deleted file',sender=NULL WHERE id=?",
    )
    .bind(t.id)
    .run();
  if (t.purged_at) return;
  if (t.upload_id) {
    try {
      await bucket().resumeMultipartUpload(key(t), t.upload_id).abort();
    } catch (e) {
      // A completed/previously-aborted multipart upload has nothing left to abort.
      if (
        !/NoSuchUpload|does not exist|already (completed|aborted)/i.test(
          String(e),
        )
      )
        throw e;
    }
  }
  await bucket().delete(key(t));
  await db().batch([
    db().prepare('DELETE FROM parts WHERE transfer_id=?').bind(t.id),
    db()
      .prepare('UPDATE transfers SET upload_id=NULL,purged_at=? WHERE id=?')
      .bind(Date.now(), t.id),
  ]);
}
export async function cleanup() {
  const expired = (
    await db()
      .prepare(
        "SELECT * FROM transfers WHERE purged_at IS NULL AND (expires_at<=? OR state='deleted') ORDER BY expires_at LIMIT 25",
      )
      .bind(Date.now())
      .all<Transfer>()
  ).results;
  let removed = 0;
  for (const t of expired) {
    try {
      await removeBytes(t);
      removed++;
    } catch {
      console.error('Expiry cleanup needs retry');
    }
  }
  await db()
    .prepare(
      'DELETE FROM rate_limits WHERE scope IN (SELECT scope FROM rate_limits WHERE reset_at<? LIMIT 100)',
    )
    .bind(Date.now() - DAY)
    .run();
  await cleanAccounts();
  return removed;
}
export async function publicTransfer(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const t = await db()
    .prepare('SELECT * FROM transfers WHERE public_id=?')
    .bind(id)
    .first<Transfer>();
  if (!t || t.state !== 'complete' || t.expires_at <= Date.now()) return null;
  return publicData(t);
}
async function download(req: Request, id: string) {
  const t = await db()
    .prepare('SELECT * FROM transfers WHERE public_id=?')
    .bind(id)
    .first<Transfer>();
  if (!t || t.state !== 'complete')
    return fail(404, 'not_found', 'This file is unavailable.');
  if (t.expires_at <= Date.now())
    return fail(410, 'expired', 'This link has expired.');
  // Force downloads; never execute uploaded HTML or SVG on our origin.
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(t.filename),
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
  });
  await rateLimit(`download:${id}`, 120);
  if (req.method === 'HEAD') {
    headers.set('Content-Length', String(t.size));
    return new Response(null, { headers });
  }
  let offset = 0,
    end = t.size - 1;
  const range = req.headers.get('Range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${t.size}` },
      });
    if (!m[1]) {
      const suffix = Number(m[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0)
        return fail(416, 'invalid_range', 'Invalid byte range.');
      offset = Math.max(0, t.size - suffix);
    } else {
      offset = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), end) : end;
    }
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(end) ||
      offset > end ||
      offset >= t.size
    )
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${t.size}` },
      });
  }
  const object = await bucket().get(
    key(t),
    range ? { range: { offset, length: end - offset + 1 } } : undefined,
  );
  if (!object || !('body' in object))
    return fail(404, 'not_found', 'This file is unavailable.');
  headers.set('Content-Length', String(end - offset + 1));
  headers.set('ETag', object.httpEtag);
  if (range) headers.set('Content-Range', `bytes ${offset}-${end}/${t.size}`);
  const allowed = await db()
    .prepare(
      "UPDATE transfers SET download_requests=download_requests+1,last_download_at=? WHERE id=? AND state='complete' AND expires_at>? RETURNING id",
    )
    .bind(Date.now(), t.id, Date.now())
    .first();
  if (!allowed) {
    void object.body.cancel().catch(() => {});
    return fail(410, 'unavailable', 'The transfer expired or was deleted.');
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
export async function handleApi(req: Request) {
  try {
    const u = new URL(req.url),
      p = u.pathname
        .replace(/^\/api\/?/, '')
        .split('/')
        .filter(Boolean),
      method = req.method;
    if (
      req.headers.has('Content-Encoding') &&
      req.headers.get('Content-Encoding') !== 'identity'
    )
      return fail(
        415,
        'unsupported_encoding',
        'Send uncompressed request bodies.',
      );
    if (!['GET', 'HEAD'].includes(method)) {
      const origin = req.headers.get('Origin');
      if (origin && origin !== u.origin)
        return fail(
          403,
          'cross_origin',
          'Cross-origin changes are not allowed.',
        );
    }
    const accountResponse = await accountRoutes(req, p, rateLimit);
    if (accountResponse) return accountResponse;
    if (p.length === 1 && p[0] === 'config' && method === 'GET')
      return json({
        mode: 'private_preview',
        max_file_bytes: MAX_BYTES,
        max_stored_bytes: MAX_STORED_BYTES,
        max_pending_uploads: MAX_PENDING_UPLOADS,
        max_daily_transfers: MAX_DAILY_TRANSFERS,
        part_size_bytes: PART_BYTES,
        retention_days: 30,
        billing: 'preview_no_charge',
        auth: 'magic_link_and_bearer_token',
        signals: 'polling',
        uploads_configured: !!bindings().BILAGA_TOKEN_HASH,
      });
    if (p.length === 1 && p[0] === 'quote' && method === 'GET') {
      const bytes = Number(u.searchParams.get('bytes'));
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 50e9)
        return fail(
          400,
          'invalid_size',
          'Quote a file between 1 byte and 50 GB.',
        );
      return json({
        size_bytes: bytes,
        estimated_price_usd: quoteCents(bytes) / 100,
        currency: 'USD',
        charged_usd: 0,
        upload_allowed: bytes <= MAX_BYTES,
        max_file_bytes: MAX_BYTES,
        billing: 'preview_no_charge',
      });
    }
    if (
      p.length === 2 &&
      p[0] === 'download' &&
      /^[a-f0-9]{32}$/.test(p[1] || '') &&
      (method === 'GET' || method === 'HEAD')
    )
      return await download(req, p[1]);
    const owner = await authorize(req);
    await rateLimit(`owner:${owner}`, 300);
    if (p.length === 1 && p[0] === 'cleanup' && method === 'POST') {
      if (owner !== bindings().BILAGA_TOKEN_HASH)
        return fail(403, 'forbidden', 'Owner access required.');
      return json({ removed: await cleanup() });
    }
    if (p[0] !== 'transfers')
      return fail(404, 'not_found', 'Endpoint not found.');
    if (p.length === 1 && method === 'POST') {
      if (owner.length === 32) {
        const allowed = await db()
          .prepare(
            'SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL AND uploads_enabled=1',
          )
          .bind(owner)
          .first();
        if (!allowed)
          return fail(
            403,
            'uploads_pending',
            'Account uploads are not enabled yet. Payments are still being prepared.',
          );
      }
      if (
        req.headers.get('Content-Type')?.split(';')[0].trim() !==
        'application/json'
      )
        return fail(415, 'content_type', 'Use Content-Type: application/json.');
      const body = await bodyJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return fail(400, 'invalid_json', 'Send a JSON object.');
      if (!validSize(body.size_bytes))
        return fail(
          400,
          'invalid_size',
          'Files must be between 1 byte and 50 GB.',
        );
      let filename: string;
      try {
        filename = cleanFilename(body.filename);
      } catch (e) {
        return fail(400, 'invalid_filename', (e as Error).message);
      }
      if (
        body.sender !== undefined &&
        (typeof body.sender !== 'string' || body.sender.length > 80)
      )
        return fail(
          400,
          'invalid_sender',
          'Sender must be at most 80 characters.',
        );
      await cleanup();
      const id = crypto.randomUUID().replaceAll('-', ''),
        publicId = crypto.randomUUID().replaceAll('-', ''),
        now = Date.now();
      // Reserve quota and the record atomically BEFORE allocating any storage.
      const reservation = await db()
        .prepare(`INSERT INTO transfers (id,public_id,owner,filename,size,sender,state,created_at,expires_at)
      SELECT ?,?,?,?,?,?,'initializing',?,? WHERE
      (length(?)=64 OR EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL AND uploads_enabled=1)) AND
      (SELECT count(*) FROM transfers WHERE owner=? AND created_at>?) < ? AND
      (SELECT count(*) FROM transfers WHERE owner=? AND state IN ('initializing','uploading','completing') AND purged_at IS NULL) < ? AND
      COALESCE((SELECT SUM(size) FROM transfers WHERE owner=? AND purged_at IS NULL),0)+? <= ? RETURNING id`)
        .bind(
          id,
          publicId,
          owner,
          filename,
          body.size_bytes,
          body.sender || null,
          now,
          now + DAY,
          owner,
          owner,
          owner,
          now - DAY,
          MAX_DAILY_TRANSFERS,
          owner,
          MAX_PENDING_UPLOADS,
          owner,
          body.size_bytes,
          MAX_STORED_BYTES,
        )
        .first();
      if (!reservation)
        return fail(
          429,
          'preview_limit',
          'Preview limit reached: 100 transfers per day, 3 unfinished uploads, or 100 GB reserved storage.',
        );
      let multi: R2MultipartUpload | undefined;
      try {
        multi = await bucket().createMultipartUpload(`transfers/${id}`, {
          httpMetadata: { contentType: 'application/octet-stream' },
        });
        const activated = await db()
          .prepare(
            "UPDATE transfers SET state='uploading',upload_id=? WHERE id=? AND state='initializing' RETURNING id",
          )
          .bind(multi.uploadId, id)
          .first();
        if (!activated) {
          await multi.abort();
          return fail(410, 'deleted', 'The upload was revoked.');
        }
      } catch (e) {
        await db()
          .prepare(
            "UPDATE transfers SET state='deleted',upload_id=?,filename='Deleted file',sender=NULL WHERE id=?",
          )
          .bind(multi?.uploadId || null, id)
          .run();
        throw e;
      }
      const t = await owned(id, owner);
      return json(
        { ...privateData(t, u.origin), upload_expires_at: iso(now + DAY) },
        201,
      );
    }
    if (p.length === 1 && method === 'GET') {
      const rows = (
        await db()
          .prepare(
            'SELECT * FROM transfers WHERE owner=? ORDER BY created_at DESC LIMIT 50',
          )
          .bind(owner)
          .all<Transfer>()
      ).results;
      return json({ transfers: rows.map((t) => privateData(t, u.origin)) });
    }
    if (!/^[a-f0-9]{32}$/.test(p[1] || ''))
      return fail(404, 'not_found', 'Transfer not found.');
    let t = await owned(p[1], owner);
    if (p.length === 2 && method === 'GET')
      return json({ ...privateData(t, u.origin), parts: await uploadParts(t) });
    if (p.length === 2 && method === 'DELETE') {
      await removeBytes(t);
      return json({ id: t.id, status: 'deleted' });
    }
    if (t.state === 'deleted' || t.expires_at <= Date.now())
      return fail(410, 'expired', 'Transfer deleted or expired.');
    if (p[2] === 'parts' && p.length === 4 && method === 'PUT') {
      if (t.state !== 'uploading')
        return fail(
          409,
          'invalid_state',
          'Upload is already complete or being finalized.',
        );
      const n = Number(p[3]),
        count = Math.ceil(t.size / PART_BYTES);
      if (!Number.isInteger(n) || n < 1 || n > count)
        return fail(400, 'invalid_part', 'Invalid part number.');
      if (activeChunkRequests >= 2)
        return fail(
          429,
          'upload_busy',
          'Two chunks are already being processed. Retry shortly.',
        );
      activeChunkRequests++;
      try {
        const expected = Math.min(PART_BYTES, t.size - (n - 1) * PART_BYTES),
          data = await boundedBody(req, expected);
        if (data.byteLength !== expected)
          return fail(
            400,
            'invalid_part_size',
            `Expected ${expected} bytes for this part.`,
          );
        const hash = await sha256(data);
        // Reserve an immutable chunk identity. Concurrent retries cannot replace it with different bytes.
        const reserved = await db()
          .prepare(`INSERT INTO parts (transfer_id,number,etag,size,content_hash)
        SELECT ?,?,'',?,? WHERE EXISTS(SELECT 1 FROM transfers WHERE id=? AND state='uploading' AND expires_at>?)
        ON CONFLICT(transfer_id,number) DO UPDATE SET etag=CASE WHEN parts.content_hash IS NULL THEN '' ELSE parts.etag END,content_hash=COALESCE(parts.content_hash,excluded.content_hash)
        WHERE parts.content_hash IS NULL OR parts.content_hash=excluded.content_hash RETURNING etag,content_hash`)
          .bind(t.id, n, data.byteLength, hash, t.id, Date.now())
          .first<{ etag: string; content_hash: string }>();
        if (!reserved)
          return fail(
            409,
            'part_conflict',
            'Transfer is no longer uploadable, or this part contains different bytes.',
          );
        if (reserved.etag)
          return json({ part_number: n, size_bytes: data.byteLength });
        const part = await bucket()
          .resumeMultipartUpload(key(t), t.upload_id!)
          .uploadPart(n, data);
        const saved = await db()
          .prepare(`UPDATE parts SET etag=? WHERE transfer_id=? AND number=? AND content_hash=? AND
        EXISTS(SELECT 1 FROM transfers WHERE id=? AND state='uploading' AND expires_at>?) RETURNING number`)
          .bind(part.etag, t.id, n, hash, t.id, Date.now())
          .first();
        if (!saved)
          return fail(410, 'unavailable', 'The upload expired or was revoked.');
        return json({ part_number: n, size_bytes: data.byteLength });
      } finally {
        activeChunkRequests--;
      }
    }

    if (p[2] === 'complete' && p.length === 3 && method === 'POST') {
      if (t.state === 'complete') return json(privateData(t, u.origin));
      const parts = await uploadParts(t);
      if (
        parts.length !== Math.ceil(t.size / PART_BYTES) ||
        parts.some((p) => !p.etag) ||
        parts.reduce((n, p) => n + p.size, 0) !== t.size
      )
        return fail(
          409,
          'incomplete',
          'Upload every part before completing the transfer.',
        );
      let object = await bucket().head(key(t));
      if (!object) {
        const leaseUntil = Date.now() + 120_000;
        const lock = await db()
          .prepare(
            "UPDATE transfers SET state='completing',completion_lock_until=? WHERE id=? AND (state='uploading' OR (state='completing' AND completion_lock_until<?))",
          )
          .bind(leaseUntil, t.id, Date.now())
          .run();
        if (!lock.meta.changes)
          return fail(
            409,
            'completing',
            'Completion is in progress. Poll status; retry completion if it remains pending.',
          );
        try {
          object = await bucket()
            .resumeMultipartUpload(key(t), t.upload_id!)
            .complete(
              parts.map((p) => ({ partNumber: p.number, etag: p.etag })),
            );
        } catch (e) {
          if ((await owned(t.id, owner)).state === 'deleted')
            return fail(410, 'deleted', 'The upload was revoked.');
          await db()
            .prepare(
              "UPDATE transfers SET state='uploading' WHERE id=? AND state='completing' AND completion_lock_until=?",
            )
            .bind(t.id, leaseUntil)
            .run();
          throw e;
        }
      }
      if (object.size !== t.size)
        return fail(
          409,
          'size_mismatch',
          'Stored file size did not match the declared size.',
        );
      const now = Date.now();
      await db()
        .prepare(
          "UPDATE transfers SET state='complete',completed_at=?,expires_at=?,upload_id=NULL WHERE id=? AND state IN ('uploading','completing')",
        )
        .bind(now, now + RETENTION, t.id)
        .run();
      t = await owned(t.id, owner);
      // Deletion can race completion; never revive a revoked transfer or keep its bytes.
      if (t.state === 'deleted') {
        await db()
          .prepare('UPDATE transfers SET purged_at=NULL WHERE id=?')
          .bind(t.id)
          .run();
        await removeBytes({ ...t, purged_at: null });
        return fail(410, 'deleted', 'Transfer was deleted.');
      }
      return json(privateData(t, u.origin));
    }
    if (p[2] === 'sent' && p.length === 3 && method === 'POST') {
      if (t.state !== 'complete')
        return fail(
          409,
          'not_ready',
          'Complete the upload before reporting it sent.',
        );
      await db()
        .prepare('UPDATE transfers SET sent_at=COALESCE(sent_at,?) WHERE id=?')
        .bind(Date.now(), t.id)
        .run();
      return json(privateData(await owned(t.id, owner), u.origin));
    }
    return fail(
      405,
      'method_not_allowed',
      'This method is not supported for the endpoint.',
    );
  } catch (e) {
    if (e instanceof ApiError) {
      const response = json(
        { error: { code: e.code, message: e.message } },
        e.status,
      );
      if (e.status === 429)
        response.headers.set(
          'Retry-After',
          e.code === 'upload_busy' ? '2' : '60',
        );
      return response;
    }
    console.error(
      'Bilaga API request failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return json(
      {
        error: {
          code: 'temporary_error',
          message: 'The request could not be completed. Please retry.',
        },
      },
      500,
    );
  }
}
