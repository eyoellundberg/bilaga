import { env } from 'cloudflare:workers';
import { bodyJson, fail, json } from './http';
import { sha256 } from './hash';
import { MAX_BYTES, MAX_STORED_BYTES, PART_BYTES } from './rules';
import { CONTENT_HASH_ALGORITHM, signPayload } from './receipts';
import { eventId } from './events';

export type FileRequest = {
  id: string; owner: string; title: string; description: string; reference: string | null;
  max_files: number; max_file_bytes: number; max_total_bytes: number;
  created_at: number; expires_at: number; submitted_at: number | null;
  submission_event_id: string | null; revoked_at: number | null;
  uploader_email: string | null; manifest: string | null;
};
const db = () => env.DB;
const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();
const requestState = (r: FileRequest) => r.revoked_at ? 'revoked' : r.submitted_at ? 'submitted' : r.expires_at <= Date.now() ? 'expired' : 'open';
function publicRequest(r: FileRequest) {
  return {
    id: r.id, title: r.title, description: r.description, status: requestState(r),
    max_files: r.max_files, max_file_bytes: r.max_file_bytes, max_total_bytes: r.max_total_bytes,
    expires_at: iso(r.expires_at), submitted_at: iso(r.submitted_at),
  };
}
export function assertRequestOpen(r: FileRequest) {
  if (requestState(r) !== 'open') return fail(409, 'request_closed', 'This request no longer accepts changes.');
}
export async function authorizeDrop(req: Request, id: string) {
  const token = req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!/^[a-f0-9]{32}$/.test(id) || !token) return fail(404, 'not_found', 'Upload request not found.');
  const r = await db().prepare(`SELECT r.* FROM file_requests r JOIN accounts a ON a.id=r.owner
    WHERE r.id=? AND r.token_hash=? AND a.deleted_at IS NULL`).bind(id, await sha256(new TextEncoder().encode(token))).first<FileRequest>();
  if (!r || r.revoked_at) return fail(404, 'not_found', 'Upload request not found.');
  return r;
}
// The upload credential never exposes download links, account details or billing.
export function dropTransfer(t: { id: string; filename: string; size: number; state: string; completed_at: number | null; expires_at: number }) {
  return { id: t.id, filename: t.filename, size_bytes: t.size,
    status: t.state === 'deleted' ? 'deleted' : t.expires_at <= Date.now() ? 'expired' : t.state,
    completed_at: iso(t.completed_at), part_size_bytes: PART_BYTES };
}
export async function dropStatus(r: FileRequest) {
  const files = (await db().prepare(`SELECT id,filename,size,state,completed_at,expires_at FROM transfers
    WHERE request_id=? AND state<>'deleted' ORDER BY created_at,id`).bind(r.id)
    .all<{ id: string; filename: string; size: number; state: string; completed_at: number | null; expires_at: number }>()).results;
  return json({ ...publicRequest(r), files: files.map(dropTransfer) });
}
export async function submitRequest(req: Request, r: FileRequest) {
  // A lost response or a double click returns the original submission.
  if (r.submitted_at) return dropStatus(r);
  assertRequestOpen(r);
  const body = await bodyJson(req);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email))
    return fail(400, 'invalid_email', 'Enter your email address.');
  const now = Date.now(), id = eventId(now);
  // Freeze the file manifest and enqueue exactly one event in the SAME batch.
  // Upload reservations check this same row, so Done and a new upload cannot race.
  const results = await db().batch([
    db().prepare(`UPDATE file_requests SET submitted_at=?,submission_event_id=?,uploader_email=?,manifest=(
      SELECT json_group_array(json_object('transfer_id',id,'public_id',public_id,'filename',filename,'size_bytes',size,'content_hash',content_hash,'completed_at',completed_at))
      FROM (SELECT * FROM transfers WHERE request_id=? AND state='complete' ORDER BY created_at,id)
    ) WHERE id=? AND submitted_at IS NULL AND revoked_at IS NULL AND expires_at>?
    AND EXISTS(SELECT 1 FROM accounts WHERE id=file_requests.owner AND deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM transfers WHERE request_id=? AND state='complete')
    AND NOT EXISTS(SELECT 1 FROM transfers WHERE request_id=? AND state<>'deleted' AND (state<>'complete' OR content_hash IS NULL OR expires_at<=?))
    RETURNING id`).bind(now, id, email, r.id, r.id, now, r.id, r.id, now),
    db().prepare(`INSERT INTO events(id,account_id,type,payload,created_at,attempts,next_attempt_at)
      SELECT ?,owner,'request.submitted',json_object('version',1,'issuer','bilaga.link','id',?,'type','request.submitted','occurred_at',?,
        'request',json_object('id',id,'reference',reference,'submitted_at',?,'files',json(manifest))),?,0,
        CASE WHEN EXISTS(SELECT 1 FROM webhooks WHERE account_id=owner) THEN ? ELSE NULL END
      FROM file_requests WHERE id=? AND submission_event_id=?`)
      .bind(id, id, iso(now), iso(now), now, now, r.id, id),
  ]);
  const fresh = await db().prepare('SELECT * FROM file_requests WHERE id=?').bind(r.id).first<FileRequest>();
  if (!fresh) return fail(410, 'request_closed', 'This request is no longer available.');
  if (!results[0].results.length && !fresh.submitted_at)
    return fail(409, 'submission_incomplete', 'Finish or remove every pending file before clicking Done. At least one completed file is required.');
  return dropStatus(fresh);
}
function integer(value: unknown, fallback: number, max: number, name: string) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max)
    return fail(400, 'invalid_request', `${name} must be an integer between 1 and ${max}.`);
  return n;
}
export async function requestRoutes(req: Request, path: string[], owner: string) {
  if (owner.length === 64) return fail(403, 'account_required', 'File requests need an account token.');
  const origin = new URL(req.url).origin;
  if (path.length === 1 && req.method === 'POST') {
    const body = await bodyJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_request', 'Send a JSON object.');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = body.description ?? '', reference = body.reference ?? null;
    if (!title || title.length > 120 || typeof description !== 'string' || description.length > 1000 || (reference !== null && (typeof reference !== 'string' || reference.length > 120)))
      return fail(400, 'invalid_request', 'Use a title up to 120 characters, instructions up to 1000 and an optional reference up to 120.');
    const maxFiles = integer(body.max_files, 20, 100, 'max_files');
    const maxTotal = integer(body.max_total_bytes, 5_000_000_000, MAX_STORED_BYTES, 'max_total_bytes');
    const maxFile = integer(body.max_file_bytes, Math.min(maxTotal, MAX_BYTES), Math.min(maxTotal, MAX_BYTES), 'max_file_bytes');
    const lifetime = integer(body.expires_in_seconds, 7 * 86400, 30 * 86400, 'expires_in_seconds');
    const id = crypto.randomUUID().replaceAll('-', '');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now();
    const result = await db().prepare(`INSERT INTO file_requests
      (id,owner,token_hash,title,description,reference,max_files,max_file_bytes,max_total_bytes,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)
      AND (SELECT COUNT(*) FROM file_requests WHERE owner=? AND submitted_at IS NULL AND revoked_at IS NULL AND expires_at>?)<100 RETURNING *`)
      .bind(id, owner, await sha256(new TextEncoder().encode(token)), title, description, reference, maxFiles, maxFile, maxTotal, now, now + lifetime * 1000, owner, owner, now).first<FileRequest>();
    if (!result) return fail(429, 'request_limit', 'At most 100 open requests are allowed. Close an existing request first.');
    return json({ ...publicRequest(result), reference, upload_url: `${origin}/r/${id}#key=${token}` }, 201);
  }
  if (path.length === 1 && req.method === 'GET') {
    const before = new URL(req.url).searchParams.get('before');
    const [stamp, cursorId] = before?.split(':') ?? [String(Number.MAX_SAFE_INTEGER), ''];
    const cutoff = Number(stamp);
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || (before !== null && !/^[a-f0-9]{32}$/.test(cursorId || '')))
      return fail(400, 'invalid_cursor', 'Use the next_before cursor returned by the previous page.');
    const rows = (await db().prepare(`SELECT * FROM file_requests WHERE owner=? AND
      (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 50`)
      .bind(owner, cutoff, cutoff, cursorId).all<FileRequest>()).results;
    const last = rows[rows.length - 1];
    return json({ requests: rows.map(r => ({ ...publicRequest(r), reference: r.reference, created_at: iso(r.created_at) })),
      next_before: rows.length === 50 ? `${last.created_at}:${last.id}` : null });
  }
  if (!/^[a-f0-9]{32}$/.test(path[1] || '')) return fail(404, 'not_found', 'Request not found.');
  const r = await db().prepare('SELECT * FROM file_requests WHERE id=? AND owner=?').bind(path[1], owner).first<FileRequest>();
  if (!r) return fail(404, 'not_found', 'Request not found.');
  if (path.length === 2 && req.method === 'GET') {
    const files = (await db().prepare('SELECT id,public_id,filename,size,state,content_hash FROM transfers WHERE request_id=? ORDER BY created_at,id').bind(r.id).all()).results;
    return json({ ...publicRequest(r), reference: r.reference, uploader_email: r.uploader_email, uploader_email_verified: false,
      files, submission: r.manifest ? JSON.parse(r.manifest) : null, receipt_url: r.submitted_at ? `${origin}/api/requests/${r.id}/receipt` : null });
  }
  if (path.length === 2 && req.method === 'DELETE') {
    await db().batch([
      db().prepare('UPDATE file_requests SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(Date.now(), r.id),
      db().prepare("UPDATE transfers SET expires_at=MIN(expires_at,?) WHERE request_id=? AND state IN ('initializing','uploading','completing')").bind(Date.now(), r.id),
    ]);
    return json({ id: r.id, status: 'revoked' });
  }
  if (path.length === 3 && path[2] === 'receipt' && req.method === 'GET') {
    if (!r.submitted_at || !r.manifest) return fail(409, 'not_submitted', 'The uploader has not clicked Done.');
    const account = await db().prepare('SELECT handle FROM accounts WHERE id=?').bind(owner).first<{ handle: string }>();
    const signed = await signPayload('submission', {
      version: 1, issuer: 'bilaga.link', request_id: r.id, requester_account: account?.handle ?? null,
      reference: r.reference, submitted_at: iso(r.submitted_at), uploader_email: r.uploader_email, uploader_email_verified: false,
      content_hash_algorithm: CONTENT_HASH_ALGORITHM, files: JSON.parse(r.manifest),
    });
    if (!signed) return fail(503, 'receipts_unavailable', 'Signed receipts are not configured.');
    return json(signed);
  }
  return fail(404, 'not_found', 'Request endpoint not found.');
}
