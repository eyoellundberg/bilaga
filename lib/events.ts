import { env } from 'cloudflare:workers';
import { bodyJson, fail, json } from './http';
import { DAY } from './rules';
import { signPayload } from './receipts';

// Every account has an append-only event log. Agents read it at GET /api/events,
// and if the account registers a webhook, each event is also pushed there, signed
// with the receipt key. Delivery is durable: rows stay pending until a 2xx arrives
// or the retry schedule is exhausted, and both request tails and the scheduled
// job drain the queue.
export const EVENT_VERSION = 1;
export const EVENT_RETENTION = 30 * DAY;
const RETRY_DELAYS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
const db = () => env.DB;
type EventRow = {
  id: string;
  account_id: string;
  type: string;
  payload: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number | null;
  delivered_at: number | null;
  last_status: number | null;
};
export type EventType =
  | 'transfer.completed'
  | 'transfer.downloaded'
  | 'transfer.received'
  | 'transfer.reply'
  | 'transfer.deleted';

// Time-ordered ids let GET /api/events?since=ID page without a second column.
function eventId(now: number) {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `evt_${now.toString(16).padStart(12, '0')}${random}`;
}
export async function recordEvent(
  accountId: string,
  type: EventType,
  transfer: Record<string, unknown>,
) {
  // Owner test tokens have no account and no event log.
  if (accountId.length === 64) return;
  const now = Date.now();
  const hook = await db()
    .prepare('SELECT url FROM webhooks WHERE account_id=?')
    .bind(accountId)
    .first<{ url: string }>();
  const id = eventId(now);
  const payload = {
    version: EVENT_VERSION,
    issuer: 'bilaga.link',
    id,
    type,
    occurred_at: new Date(now).toISOString(),
    transfer,
  };
  await db()
    .prepare(
      'INSERT INTO events (id,account_id,type,payload,created_at,attempts,next_attempt_at) VALUES (?,?,?,?,?,0,?)',
    )
    .bind(id, accountId, type, JSON.stringify(payload), now, hook ? now : null)
    .run();
}
export async function signedEvent(row: EventRow) {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const signed = await signPayload('event', payload);
  return (
    signed || {
      event: payload,
      signature_hex: null,
      key_id: null,
      public_key_hex: null,
      algorithm: null,
      canonicalization: null,
      verify_url: '/api/receipt-key',
    }
  );
}
async function deliverOne(row: EventRow, url: string) {
  const now = Date.now();
  const body = await signedEvent(row);
  let status = 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Bilaga-Webhook/1',
        'X-Bilaga-Event': row.type,
        'X-Bilaga-Delivery': row.id,
        'X-Bilaga-Signature': body.signature_hex || '',
        'X-Bilaga-Key-Id': body.key_id || '',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    // Drain a small body so the connection is reusable; never read a large one.
    void res.body?.cancel().catch(() => {});
  } catch {
    status = 0;
  }
  const ok = status >= 200 && status < 300;
  const attempts = row.attempts + 1;
  const next = ok || attempts > RETRY_DELAYS.length ? null : now + RETRY_DELAYS[attempts - 1];
  await db()
    .prepare(
      'UPDATE events SET attempts=?,last_status=?,delivered_at=?,next_attempt_at=? WHERE id=? AND attempts=?',
    )
    .bind(attempts, status, ok ? now : null, next, row.id, row.attempts)
    .run();
  return ok;
}
// Bounded drain. Claims rows by advancing next_attempt_at so overlapping drains
// (request tail plus scheduled job) do not double-deliver.
export async function deliverPending(limit = 10) {
  const now = Date.now();
  const rows = (
    await db()
      .prepare(
        `UPDATE events SET next_attempt_at=? WHERE id IN (
           SELECT id FROM events WHERE delivered_at IS NULL AND next_attempt_at IS NOT NULL AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT ?
         ) RETURNING *`,
      )
      .bind(now + 60_000, now, limit)
      .all<EventRow>()
  ).results;
  let delivered = 0;
  for (const row of rows) {
    const hook = await db()
      .prepare('SELECT url FROM webhooks WHERE account_id=?')
      .bind(row.account_id)
      .first<{ url: string }>();
    if (!hook) {
      await db()
        .prepare('UPDATE events SET next_attempt_at=NULL WHERE id=?')
        .bind(row.id)
        .run();
      continue;
    }
    if (await deliverOne(row, hook.url)) delivered++;
  }
  return delivered;
}
export async function pruneEvents() {
  await db()
    .prepare(
      'DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at<? LIMIT 200)',
    )
    .bind(Date.now() - EVENT_RETENTION)
    .run();
}
// Webhook targets must be public HTTPS endpoints. Loopback HTTP is allowed only
// when the API itself is running on loopback, for local tests.
export function validateWebhookUrl(raw: unknown, apiOrigin: string) {
  if (typeof raw !== 'string' || raw.length > 2048)
    return fail(400, 'invalid_url', 'Send an https URL of at most 2048 characters.');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail(400, 'invalid_url', 'Send a valid https URL.');
  }
  const localApi = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiOrigin);
  const loopback = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.username || u.password || u.hash)
    return fail(400, 'invalid_url', 'Webhook URLs cannot contain credentials or fragments.');
  if (u.protocol === 'http:' && !(localApi && loopback))
    return fail(400, 'invalid_url', 'Webhook URLs must use https.');
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return fail(400, 'invalid_url', 'Webhook URLs must use https.');
  const host = u.hostname;
  if (
    !loopback &&
    (/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.startsWith('[') ||
      !host.includes('.') ||
      /\.(local|internal|localhost)$/.test(host))
  )
    return fail(400, 'invalid_url', 'Webhook URLs must use a public hostname, not an IP address.');
  return u.toString();
}
type Limit = (scope: string, count: number, window?: number) => Promise<void>;
// Routes under /api/webhook and /api/events. The caller has already authenticated
// the bearer token; `owner` is the account id.
export async function eventRoutes(
  req: Request,
  path: string[],
  owner: string,
  limit: Limit,
): Promise<Response | null> {
  if (path[0] !== 'webhook' && path[0] !== 'events') return null;
  if (owner.length === 64)
    return fail(403, 'account_required', 'Webhooks and events need an account token.');
  const u = new URL(req.url);
  if (path[0] === 'webhook' && path.length === 1) {
    if (req.method === 'GET') {
      const hook = await db()
        .prepare('SELECT url,created_at,updated_at FROM webhooks WHERE account_id=?')
        .bind(owner)
        .first<{ url: string; created_at: number; updated_at: number }>();
      const recent = (
        await db()
          .prepare(
            'SELECT id,type,created_at,attempts,delivered_at,last_status,next_attempt_at FROM events WHERE account_id=? AND attempts>0 ORDER BY created_at DESC LIMIT 10',
          )
          .bind(owner)
          .all<EventRow>()
      ).results;
      return json({
        webhook: hook
          ? {
              url: hook.url,
              created_at: new Date(hook.created_at).toISOString(),
              updated_at: new Date(hook.updated_at).toISOString(),
            }
          : null,
        recent_deliveries: recent.map((r) => ({
          id: r.id,
          type: r.type,
          created_at: new Date(r.created_at).toISOString(),
          attempts: r.attempts,
          last_status: r.last_status,
          delivered: !!r.delivered_at,
          next_attempt_at: r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
        })),
        events: ['transfer.completed', 'transfer.downloaded', 'transfer.received', 'transfer.reply', 'transfer.deleted'],
      });
    }
    if (req.method === 'PUT') {
      await limit(`webhook-set:${owner}`, 10);
      const body = await bodyJson(req);
      const url = validateWebhookUrl(body?.url, u.origin);
      const now = Date.now();
      await db()
        .prepare(
          `INSERT INTO webhooks (account_id,url,created_at,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(account_id) DO UPDATE SET url=excluded.url,updated_at=excluded.updated_at`,
        )
        .bind(owner, url, now, now)
        .run();
      return json({ webhook: { url, updated_at: new Date(now).toISOString() } });
    }
    if (req.method === 'DELETE') {
      await db().batch([
        db().prepare('DELETE FROM webhooks WHERE account_id=?').bind(owner),
        db()
          .prepare('UPDATE events SET next_attempt_at=NULL WHERE account_id=? AND delivered_at IS NULL')
          .bind(owner),
      ]);
      return json({ webhook: null });
    }
    return fail(405, 'method_not_allowed', 'Use GET, PUT, or DELETE.');
  }
  if (path[0] === 'webhook' && path.length === 2 && path[1] === 'test' && req.method === 'POST') {
    await limit(`webhook-test:${owner}`, 5);
    const hook = await db()
      .prepare('SELECT url FROM webhooks WHERE account_id=?')
      .bind(owner)
      .first<{ url: string }>();
    if (!hook) return fail(404, 'no_webhook', 'Register a webhook first.');
    const now = Date.now();
    const id = eventId(now);
    const payload = {
      version: EVENT_VERSION,
      issuer: 'bilaga.link',
      id,
      type: 'webhook.test',
      occurred_at: new Date(now).toISOString(),
      transfer: null,
    };
    const row: EventRow = {
      id,
      account_id: owner,
      type: 'webhook.test',
      payload: JSON.stringify(payload),
      created_at: now,
      attempts: 0,
      next_attempt_at: null,
      delivered_at: null,
      last_status: null,
    };
    await db()
      .prepare(
        'INSERT INTO events (id,account_id,type,payload,created_at,attempts,next_attempt_at) VALUES (?,?,?,?,?,0,NULL)',
      )
      .bind(id, owner, row.type, row.payload, now)
      .run();
    const ok = await deliverOne(row, hook.url);
    const after = await db()
      .prepare('SELECT last_status FROM events WHERE id=?')
      .bind(id)
      .first<{ last_status: number }>();
    return json({ delivered: ok, status: after?.last_status ?? 0, id });
  }
  if (path[0] === 'events' && path.length === 1 && req.method === 'GET') {
    const since = u.searchParams.get('since') || '';
    if (since && !/^evt_[a-f0-9]{28}$/.test(since))
      return fail(400, 'invalid_cursor', 'since must be an event id.');
    const type = u.searchParams.get('type') || '';
    const rows = (
      await db()
        .prepare(
          `SELECT * FROM events WHERE account_id=? AND id>? AND (?='' OR type=?) AND type<>'webhook.test' ORDER BY id LIMIT 100`,
        )
        .bind(owner, since, type, type)
        .all<EventRow>()
    ).results;
    const events = await Promise.all(rows.map(signedEvent));
    return json({
      events,
      next_since: rows.length ? rows[rows.length - 1].id : since || null,
      has_more: rows.length === 100,
    });
  }
  return fail(404, 'not_found', 'Endpoint not found.');
}
