import { json, fail, ApiError, bodyJson, boundedBody } from './http';
import { accountRoutes, tokenOwner, cleanAccounts } from './accounts';
import { recordEvent, eventRoutes, deliverPending, pruneEvents } from './events';
export { json } from './http';
import { sha256 } from './hash';
import { env } from 'cloudflare:workers';
import {
  MAX_BYTES,
  PART_BYTES,
  DAY,
  LIMITS,
  describeLimits,
  feeCents,
  validPrice,
  FEE_BPS,
  fileLabel,
  quoteCents,
  validSize,
  cleanFilename,
  contentDisposition,
} from './rules';
import {
  CONTENT_HASH_ALGORITHM,
  RECEIPT_VERSION,
  contentHash,
  publicKeyInfo,
  signReceipt,
} from './receipts';

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
  content_hash: string | null;
  recipient: string | null;
  received_at: number | null;
  received_by: string | null;
  in_reply_to: string | null;
  price_cents: number;
  paid_at: number | null;
  paid_by: string | null;
  receipt_requests: number;
};
type AccountIdentity = { id: string; email: string | null; handle: string | null };
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
async function accountIdentity(id: string | null): Promise<AccountIdentity | null> {
  if (!id || id.length === 64) return null;
  return (
    (await db()
      .prepare('SELECT id,email,handle FROM accounts WHERE id=? AND deleted_at IS NULL')
      .bind(id)
      .first<AccountIdentity>()) || null
  );
}
export const handleOf = async (id: string | null) =>
  !id || id.length === 64
    ? null
    : ((await db().prepare('SELECT handle FROM accounts WHERE id=?').bind(id).first<{ handle: string | null }>())?.handle ?? null);
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
async function rateLimit(scope: string, limit: number, window = 60_000) {
  const now = Date.now(),
    reset = now + window;
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
// One tier for everyone. The lookup still confirms the account is live.
async function limitsFor(owner: string) {
  if (owner.length === 64) return LIMITS;
  const account = await db()
    .prepare('SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL')
    .bind(owner)
    .first();
  if (!account) return fail(401, 'unauthorized', 'A valid Bilaga token is required.');
  return LIMITS;
}
// Settle a priced transfer inside one D1 batch. Every statement is guarded by
// the same condition, so either all of it applies or none of it does.
async function settle(t: Transfer, payer: AccountIdentity) {
  const now = Date.now(),
    fee = feeCents(t.price_cents),
    net = t.price_cents - fee;
  const paidMark = db()
    .prepare(
      `UPDATE transfers SET paid_at=?,paid_by=? WHERE id=? AND paid_at IS NULL AND state='complete' AND expires_at>? AND price_cents=?
       AND (SELECT balance_cents FROM accounts WHERE id=? AND deleted_at IS NULL)>=? RETURNING id`,
    )
    .bind(now, payer.id, t.id, now, t.price_cents, payer.id, t.price_cents);
  const guard = `EXISTS(SELECT 1 FROM transfers WHERE id='${t.id}' AND paid_by='${payer.id}' AND paid_at=${now})`;
  const row = (kind: string, account: string, delta: number, note: string | null) =>
    db()
      .prepare(
        `INSERT INTO ledger (id,account_id,delta_cents,balance_after,kind,transfer_id,note,created_at)
         SELECT ?,?,?,COALESCE((SELECT balance_cents FROM accounts WHERE id=?),0),?,?,?,? WHERE ${guard}`,
      )
      .bind(crypto.randomUUID().replaceAll('-', ''), account, delta, account, kind, t.id, note, now);
  const results = await db().batch([
    paidMark,
    db()
      .prepare(`UPDATE accounts SET balance_cents=balance_cents-? WHERE id=? AND ${guard}`)
      .bind(t.price_cents, payer.id),
    row('payment', payer.id, -t.price_cents, `Paid for ${t.filename}`),
    db()
      .prepare(`UPDATE accounts SET balance_cents=balance_cents+? WHERE id=? AND deleted_at IS NULL AND ${guard}`)
      .bind(net, t.owner),
    row('sale', t.owner, net, `Sold ${t.filename} (fee ${fee} cents)`),
    row('fee', 'bilaga', fee, null),
  ]);
  return results[0].results.length > 0;
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
    addressed: !!t.recipient,
    in_reply_to: t.in_reply_to,
    price_cents: t.price_cents,
    paid: t.price_cents > 0 ? !!t.paid_at : null,
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
    receipt_requests: t.receipt_requests,
    last_download_requested_at: iso(t.last_download_at),
    download_note:
      'Requests indicate a download was started, not completed or read.',
    share_url: t.state === 'complete' ? `${origin}/t/${t.public_id}` : null,
    receipt_url:
      t.state === 'complete' && t.content_hash
        ? `${origin}/api/receipts/${t.public_id}`
        : null,
    content_hash: t.content_hash,
    content_hash_algorithm: t.content_hash ? CONTENT_HASH_ALGORITHM : null,
    to: t.recipient,
    received_at: iso(t.received_at),
    paid_at: iso(t.paid_at),
    estimated_storage_price_usd: quoteCents(t.size) / 100,
    charged_usd: 0,
    billing: 'storage_not_charged',
    part_size_bytes: PART_BYTES,
  };
}
// What an account's own webhook and event feed see about its transfer.
function eventData(t: Transfer, origin: string) {
  return {
    id: t.id,
    public_id: t.public_id,
    filename: t.filename,
    size_bytes: t.size,
    sender: t.sender,
    to: t.recipient,
    in_reply_to: t.in_reply_to,
    content_hash: t.content_hash,
    share_url: `${origin}/t/${t.public_id}`,
    receipt_url: `${origin}/api/receipts/${t.public_id}`,
    completed_at: iso(t.completed_at),
    expires_at: iso(t.expires_at),
    received_at: iso(t.received_at),
    price_cents: t.price_cents,
    paid_at: iso(t.paid_at),
    download_requests: t.download_requests,
    receipt_requests: t.receipt_requests,
  };
}
// What a recipient sees: everything public plus the sender's stable handle.
async function inboxData(t: Transfer, origin: string) {
  return {
    ...publicData(t),
    public_id: t.public_id,
    from_account: await handleOf(t.owner),
    completed_at: iso(t.completed_at),
    received_at: iso(t.received_at),
    paid_at: iso(t.paid_at),
    pay_url: t.price_cents > 0 && !t.paid_at ? `${origin}/api/inbox/${t.public_id}/pay` : null,
    share_url: `${origin}/t/${t.public_id}`,
    download_url: `${origin}/api/download/${t.public_id}`,
    receipt_url: t.content_hash ? `${origin}/api/receipts/${t.public_id}` : null,
    content_hash: t.content_hash,
  };
}
async function markReceived(t: Transfer, account: AccountIdentity, origin: string) {
  if (!t.recipient || t.recipient !== account.email) return false;
  const first = await db()
    .prepare(
      "UPDATE transfers SET received_at=?,received_by=? WHERE id=? AND received_at IS NULL AND state='complete' RETURNING id",
    )
    .bind(Date.now(), account.id, t.id)
    .first();
  if (first) {
    const fresh = (await db().prepare('SELECT * FROM transfers WHERE id=?').bind(t.id).first<Transfer>())!;
    await recordEvent(t.owner, 'transfer.received', {
      ...eventData(fresh, origin),
      received_by: account.handle,
    });
  }
  return true;
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
  await pruneEvents();
  await deliverPending();
  return removed;
}
export async function publicTransfer(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const t = await db()
    .prepare('SELECT * FROM transfers WHERE public_id=?')
    .bind(id)
    .first<Transfer>();
  if (!t || t.state !== 'complete' || t.expires_at <= Date.now()) return null;
  return { ...publicData(t), public_id: t.public_id, content_hash: t.content_hash };
}
// Receipts are kept indefinitely. After deletion the filename, sender label
// and addressing are already redacted; the hash, sizes, handles and times remain.
async function signedReceiptFor(t: Transfer) {
  return signReceipt({
    version: RECEIPT_VERSION,
    issuer: 'bilaga.link',
    transfer: t.public_id,
    status: t.state === 'deleted' ? 'deleted' : t.expires_at <= Date.now() ? 'expired' : 'available',
    filename: t.filename,
    size_bytes: t.size,
    part_size_bytes: PART_BYTES,
    content_hash: t.content_hash,
    content_hash_algorithm: CONTENT_HASH_ALGORITHM,
    sender: t.sender,
    sender_account: await handleOf(t.owner),
    addressed: !!t.recipient,
    recipient_account: t.received_by ? await handleOf(t.received_by) : null,
    received_at: iso(t.received_at),
    in_reply_to: t.in_reply_to,
    price_cents: t.price_cents,
    fee_cents: t.paid_at ? feeCents(t.price_cents) : null,
    paid_at: iso(t.paid_at),
    paid_by_account: t.paid_by ? await handleOf(t.paid_by) : null,
    completed_at: iso(t.completed_at),
    expires_at: iso(t.expires_at),
    sent_reported_at: iso(t.sent_at),
    download_requests: t.download_requests,
    last_download_requested_at: iso(t.last_download_at),
    receipt_requests: t.receipt_requests,
    issued_at: new Date().toISOString(),
  });
}
const receiptable = (t: Transfer | null): t is Transfer =>
  !!t && !!t.content_hash && (t.state === 'complete' || t.state === 'deleted');
async function receipt(id: string) {
  const t = await db()
    .prepare('UPDATE transfers SET receipt_requests=receipt_requests+1 WHERE public_id=? AND content_hash IS NOT NULL RETURNING *')
    .bind(id)
    .first<Transfer>();
  if (!receiptable(t))
    return fail(404, 'not_found', 'No receipt is available for this transfer.');
  const signed = await signedReceiptFor(t);
  if (!signed)
    return fail(503, 'receipts_unavailable', 'Receipt signing is not configured.');
  return json(signed);
}
// Anyone holding a file can ask whether Bilaga ever recorded those bytes.
async function receiptsByHash(hash: string) {
  const rows = (
    await db()
      .prepare("UPDATE transfers SET receipt_requests=receipt_requests+1 WHERE content_hash=? AND state IN ('complete','deleted') RETURNING *")
      .bind(hash)
      .all<Transfer>()
  ).results
    .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0))
    .slice(0, 10);
  const receipts = [];
  for (const t of rows) {
    const signed = await signedReceiptFor(t);
    if (!signed) return fail(503, 'receipts_unavailable', 'Receipt signing is not configured.');
    receipts.push(signed);
  }
  return json({ content_hash: hash, receipts });
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
  if (t.price_cents > 0 && !t.paid_at)
    return fail(
      402,
      'payment_required',
      `This file costs ${(t.price_cents / 100).toFixed(2)} USD. Sign in with the address it was sent to and pay from your balance, or ask your agent to POST /api/inbox/{public_id}/pay.`,
    );
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
  // A recipient's agent downloading with its own token records who received it.
  const bearer = req.headers.has('Authorization') ? await accountIdentity(await authorize(req)) : null;
  const allowed = await db()
    .prepare(
      "UPDATE transfers SET download_requests=download_requests+1,last_download_at=? WHERE id=? AND state='complete' AND expires_at>? RETURNING download_requests",
    )
    .bind(Date.now(), t.id, Date.now())
    .first<{ download_requests: number }>();
  if (!allowed) {
    void object.body.cancel().catch(() => {});
    return fail(410, 'unavailable', 'The transfer expired or was deleted.');
  }
  const origin = new URL(req.url).origin;
  if (allowed.download_requests === 1)
    await recordEvent(t.owner, 'transfer.downloaded', eventData({ ...t, download_requests: 1 }, origin));
  if (bearer) await markReceived(t, bearer, origin);
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
        mode: 'open',
        ...describeLimits(),
        part_size_bytes: PART_BYTES,
        receipts: (await publicKeyInfo()) ? 'signed_ed25519' : 'unavailable',
        billing: 'storage_not_charged',
        payments: { transfer_prices: 'balance', fee_bps: FEE_BPS, top_ups: 'operator_grant_only' },
        auth: 'magic_link_and_bearer_token',
        signals: 'polling_events_webhooks',
        addressing: 'email',
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
        billing: 'storage_not_charged',
      });
    }
    if (p.length === 1 && p[0] === 'receipt-key' && method === 'GET') {
      const info = await publicKeyInfo();
      if (!info) return fail(503, 'receipts_unavailable', 'Receipt signing is not configured.');
      return json({
        ...info,
        issuer: 'bilaga.link',
        content_hash_algorithm: CONTENT_HASH_ALGORITHM,
        retired_key_ids: [],
        spec_url: `${u.origin}/verify`,
      });
    }
    if (p.length === 1 && p[0] === 'receipts' && method === 'GET') {
      const hash = u.searchParams.get('hash') || '';
      if (!/^[a-f0-9]{64}$/.test(hash))
        return fail(400, 'invalid_hash', 'Pass ?hash= as the 64-hex bilaga-chunked-sha256-8mib content hash.');
      await rateLimit(`receipt-lookup:${await sha256(new TextEncoder().encode(req.headers.get('CF-Connecting-IP') || 'local'))}`, 60);
      return await receiptsByHash(hash);
    }
    if (
      p.length === 2 &&
      p[0] === 'receipts' &&
      /^[a-f0-9]{32}$/.test(p[1] || '') &&
      method === 'GET'
    ) {
      await rateLimit(`receipt:${p[1]}`, 60);
      return await receipt(p[1]);
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
    // Until card top-ups exist, the operator token grants credit by email.
    if (p.length === 1 && p[0] === 'credits' && method === 'POST') {
      if (owner !== bindings().BILAGA_TOKEN_HASH)
        return fail(403, 'forbidden', 'Owner access required.');
      const body = await bodyJson(req);
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const cents = body?.cents;
      if (!EMAIL.test(email) || !Number.isInteger(cents) || cents <= 0 || cents > 10_000_000)
        return fail(400, 'invalid_grant', 'Send an email and a positive integer number of cents.');
      const now = Date.now();
      const account = await db()
        .prepare('UPDATE accounts SET balance_cents=balance_cents+? WHERE email=? AND deleted_at IS NULL RETURNING id,balance_cents,handle')
        .bind(cents, email)
        .first<{ id: string; balance_cents: number; handle: string }>();
      if (!account) return fail(404, 'not_found', 'No account has that email.');
      await db()
        .prepare('INSERT INTO ledger (id,account_id,delta_cents,balance_after,kind,transfer_id,note,created_at) VALUES (?,?,?,?,?,NULL,?,?)')
        .bind(crypto.randomUUID().replaceAll('-', ''), account.id, cents, account.balance_cents, 'grant', typeof body.note === 'string' ? body.note.slice(0, 120) : null, now)
        .run();
      return json({ account: account.handle, balance_cents: account.balance_cents });
    }
    if (p.length === 1 && p[0] === 'balance' && method === 'GET') {
      const me = await accountIdentity(owner);
      if (!me) return fail(403, 'account_required', 'Balances need an account token.');
      const balance = await db()
        .prepare('SELECT balance_cents FROM accounts WHERE id=?')
        .bind(me.id)
        .first<{ balance_cents: number }>();
      const rows = (
        await db()
          .prepare('SELECT delta_cents,balance_after,kind,transfer_id,note,created_at FROM ledger WHERE account_id=? ORDER BY created_at DESC LIMIT 50')
          .bind(me.id)
          .all<{ delta_cents: number; balance_after: number; kind: string; transfer_id: string | null; note: string | null; created_at: number }>()
      ).results;
      return json({
        account: me.handle,
        balance_cents: balance?.balance_cents ?? 0,
        currency: 'USD',
        top_ups: 'Card top-ups are not available yet; credit is granted by the operator.',
        ledger: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })),
      });
    }
    if (p.length === 1 && p[0] === 'cleanup' && method === 'POST') {
      if (owner !== bindings().BILAGA_TOKEN_HASH)
        return fail(403, 'forbidden', 'Owner access required.');
      return json({ removed: await cleanup() });
    }
    const eventResponse = await eventRoutes(req, p, owner, rateLimit);
    if (eventResponse) return eventResponse;
    if (p[0] === 'inbox') {
      const me = await accountIdentity(owner);
      if (!me?.email)
        return fail(403, 'account_required', 'The inbox needs an account token.');
      if (p.length === 1 && method === 'GET') {
        const rows = (
          await db()
            .prepare(
              "SELECT * FROM transfers WHERE recipient=? AND state='complete' AND expires_at>? ORDER BY completed_at DESC LIMIT 50",
            )
            .bind(me.email, Date.now())
            .all<Transfer>()
        ).results;
        return json({
          account: me.handle,
          transfers: await Promise.all(rows.map((t) => inboxData(t, u.origin))),
        });
      }
      if (p.length === 3 && /^[a-f0-9]{32}$/.test(p[1]) && p[2] === 'pay' && method === 'POST') {
        await rateLimit(`pay:${me.id}`, 30);
        const t = await db()
          .prepare("SELECT * FROM transfers WHERE public_id=? AND recipient=? AND state='complete'")
          .bind(p[1], me.email)
          .first<Transfer>();
        if (!t) return fail(404, 'not_found', 'No transfer addressed to you has that id.');
        if (t.expires_at <= Date.now()) return fail(410, 'expired', 'This transfer has expired.');
        if (t.price_cents === 0) return fail(409, 'not_priced', 'This transfer is free.');
        if (t.paid_at) {
          if (t.paid_by !== me.id) return fail(409, 'already_paid', 'Someone else already paid for this transfer.');
        } else {
          const balance = await db()
            .prepare('SELECT balance_cents FROM accounts WHERE id=?')
            .bind(me.id)
            .first<{ balance_cents: number }>();
          if ((balance?.balance_cents ?? 0) < t.price_cents)
            return fail(402, 'insufficient_balance', `Your balance is ${balance?.balance_cents ?? 0} cents; this transfer costs ${t.price_cents}.`);
          if (!(await settle(t, me)))
            return fail(409, 'payment_conflict', 'The transfer was paid or changed concurrently. Check the inbox again.');
          const fresh = (await db().prepare('SELECT * FROM transfers WHERE id=?').bind(t.id).first<Transfer>())!;
          await recordEvent(t.owner, 'transfer.paid', { ...eventData(fresh, u.origin), paid_by: me.handle, net_cents: t.price_cents - feeCents(t.price_cents) });
          await recordEvent(me.id, 'transfer.paid', { ...(await inboxData(fresh, u.origin)), paid_by: me.handle });
          await markReceived(fresh, me, u.origin);
        }
        const fresh = (await db().prepare('SELECT * FROM transfers WHERE id=?').bind(t.id).first<Transfer>())!;
        return json(await inboxData(fresh, u.origin));
      }
      if (p.length === 3 && /^[a-f0-9]{32}$/.test(p[1]) && p[2] === 'received' && method === 'POST') {
        const t = await db()
          .prepare("SELECT * FROM transfers WHERE public_id=? AND recipient=? AND state='complete'")
          .bind(p[1], me.email)
          .first<Transfer>();
        if (!t) return fail(404, 'not_found', 'No transfer addressed to you has that id.');
        await markReceived(t, me, u.origin);
        const fresh = (await db().prepare('SELECT * FROM transfers WHERE id=?').bind(t.id).first<Transfer>())!;
        return json(await inboxData(fresh, u.origin));
      }
      return fail(404, 'not_found', 'Endpoint not found.');
    }
    if (p[0] !== 'transfers')
      return fail(404, 'not_found', 'Endpoint not found.');
    if (p.length === 1 && method === 'POST') {
      const limits = await limitsFor(owner);
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
      if (body.size_bytes > limits.max_file_bytes)
        return fail(413, 'too_large', `Files can be at most ${fileLabel(limits.max_file_bytes)}.`);
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
      // Addressing. `to` is an email; `in_reply_to` chains this transfer to one
      // the creator received, and defaults `to` to that transfer's sender.
      let recipient: string | null = null;
      let inReplyTo: string | null = null;
      if (body.to !== undefined && body.to !== null) {
        const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
        if (!to || to.length > 254 || !EMAIL.test(to))
          return fail(400, 'invalid_recipient', 'to must be a valid email address.');
        recipient = to;
      }
      if (body.in_reply_to !== undefined && body.in_reply_to !== null) {
        if (typeof body.in_reply_to !== 'string' || !/^[a-f0-9]{32}$/.test(body.in_reply_to))
          return fail(400, 'invalid_reply', 'in_reply_to must be a transfer public id.');
        const me = await accountIdentity(owner);
        const original = me?.email
          ? await db()
              .prepare("SELECT * FROM transfers WHERE public_id=? AND recipient=? AND state='complete'")
              .bind(body.in_reply_to, me.email)
              .first<Transfer>()
          : null;
        if (!original)
          return fail(404, 'invalid_reply', 'You can only reply to a transfer addressed to you.');
        inReplyTo = original.public_id;
        if (!recipient) {
          const sender = await accountIdentity(original.owner);
          if (!sender?.email)
            return fail(409, 'sender_gone', 'The original sender no longer has an account. Set `to` explicitly.');
          recipient = sender.email;
        }
      }
      let price = 0;
      if (body.price_cents !== undefined && body.price_cents !== null) {
        if (!validPrice(body.price_cents))
          return fail(400, 'invalid_price', 'price_cents must be an integer between 0 and 1,000,000.');
        price = body.price_cents;
        if (price > 0 && !recipient)
          return fail(400, 'price_needs_recipient', 'A priced transfer must be addressed with `to`.');
        if (price > 0 && owner.length === 64)
          return fail(403, 'account_required', 'Priced transfers need an account token.');
      }
      await cleanup();
      const id = crypto.randomUUID().replaceAll('-', ''),
        publicId = crypto.randomUUID().replaceAll('-', ''),
        now = Date.now();
      // Reserve quota and the record atomically BEFORE allocating any storage.
      const reservation = await db()
        .prepare(`INSERT INTO transfers (id,public_id,owner,filename,size,sender,recipient,in_reply_to,price_cents,state,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,'initializing',?,? WHERE
      (length(?)=64 OR EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)) AND
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
          recipient,
          inReplyTo,
          price,
          now,
          now + DAY,
          owner,
          owner,
          owner,
          now - DAY,
          limits.max_daily_transfers,
          owner,
          limits.max_pending_uploads,
          owner,
          body.size_bytes,
          limits.max_stored_bytes,
        )
        .first();
      if (!reservation)
        return fail(
          429,
          'account_limit',
          `Limit reached: ${limits.max_daily_transfers} transfers per day, ${limits.max_pending_uploads} unfinished upload${limits.max_pending_uploads === 1 ? '' : 's'}, or ${fileLabel(limits.max_stored_bytes)} reserved storage.`,
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
      const wasComplete = t.state === 'complete';
      await removeBytes(t);
      if (wasComplete) await recordEvent(owner, 'transfer.deleted', eventData(t, u.origin));
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
      const hashes = parts.map((p) => p.content_hash);
      const digest = hashes.every((h): h is string => !!h)
        ? await contentHash(hashes)
        : null;
      const limits = await limitsFor(owner);
      await db()
        .prepare(
          "UPDATE transfers SET state='complete',completed_at=?,expires_at=?,upload_id=NULL,content_hash=? WHERE id=? AND state IN ('uploading','completing')",
        )
        .bind(now, now + limits.retention_ms, digest, t.id)
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
      await recordEvent(owner, 'transfer.completed', eventData(t, u.origin));
      if (t.in_reply_to) {
        const original = await db()
          .prepare('SELECT owner FROM transfers WHERE public_id=?')
          .bind(t.in_reply_to)
          .first<{ owner: string }>();
        if (original)
          await recordEvent(original.owner, 'transfer.reply', {
            public_id: t.public_id,
            filename: t.filename,
            size_bytes: t.size,
            sender: t.sender,
            from_account: await handleOf(owner),
            in_reply_to: t.in_reply_to,
            price_cents: t.price_cents,
            content_hash: t.content_hash,
            share_url: `${u.origin}/t/${t.public_id}`,
            receipt_url: `${u.origin}/api/receipts/${t.public_id}`,
            completed_at: iso(t.completed_at),
            expires_at: iso(t.expires_at),
          });
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
