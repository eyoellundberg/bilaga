import { env } from 'cloudflare:workers';
import { sha256 } from './hash';
import { bodyJson, fail, json } from './http';
import { DAY, TIERS, describeLimits } from './rules';

const db = () => env.DB;
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const hash = (s: string) => sha256(new TextEncoder().encode(s));
const settings = () =>
  env as unknown as {
    EMAIL?: {
      send(message: {
        from: string;
        to: string;
        subject: string;
        text: string;
      }): Promise<unknown>;
    };
    AUTH_ORIGIN?: string;
  };
function cookieName(req: Request, kind: string) {
  return `${new URL(req.url).protocol === 'https:' ? '__Host-' : ''}bilaga_${kind}`;
}
function cookie(req: Request, kind: string) {
  const name = cookieName(req, kind) + '=';
  return (
    req.headers
      .get('Cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name))
      ?.slice(name.length) || ''
  );
}
function setCookie(
  req: Request,
  response: Response,
  kind: string,
  value: string,
  age: number,
) {
  response.headers.append(
    'Set-Cookie',
    `${cookieName(req, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`,
  );
}
type Session = {
  id: string;
  email: string;
  created_at: number;
  uploads_enabled: number;
};
async function session(req: Request) {
  const token = cookie(req, 'session');
  if (!/^[a-f0-9]{64}$/.test(token))
    return fail(401, 'sign_in', 'Sign in to manage your account.');
  const row = await db()
    .prepare(`SELECT a.id,a.email,s.created_at,a.uploads_enabled FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.hash=? AND s.expires_at>? AND a.deleted_at IS NULL`)
    .bind(await hash(token), Date.now())
    .first<Session>();
  if (!row)
    return fail(401, 'sign_in', 'Your session has expired. Sign in again.');
  return row;
}
export async function tokenOwner(tokenHash: string) {
  return (
    (
      await db()
        .prepare(`SELECT a.id FROM api_tokens t JOIN accounts a ON a.id=t.account_id
    WHERE t.hash=? AND a.deleted_at IS NULL`)
        .bind(tokenHash)
        .first<{ id: string }>()
    )?.id || null
  );
}
export async function accountRoutes(
  req: Request,
  path: string[],
  limit: (scope: string, count: number, window?: number) => Promise<void>,
): Promise<Response | null> {
  if (!['auth', 'account'].includes(path[0])) return null;
  const route = path.join('/');
  const method = req.method;
  const origin = new URL(req.url).origin;
  const canonical = settings().AUTH_ORIGIN || 'https://bilaga.link';
  const local = ['http://localhost:3119', 'http://127.0.0.1:3119'].includes(
    origin,
  );
  if (!local && origin !== canonical)
    return fail(
      400,
      'wrong_origin',
      'Open https://bilaga.link/account to sign in.',
    );
  if (!['GET', 'HEAD'].includes(method) && req.headers.get('Origin') !== origin)
    return fail(
      403,
      'cross_origin',
      'Account changes must come from this website.',
    );
  if (route === 'auth/request' && method === 'POST') {
    if (!settings().EMAIL)
      return fail(
        503,
        'email_unavailable',
        'Email sign-in is not configured yet.',
      );
    await limit(
      `login-ip:${await hash(req.headers.get('CF-Connecting-IP') || 'local')}`,
      5,
    );
    const body = await bodyJson(req);
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (
      email.length > 254 ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
        email,
      )
    )
      return fail(400, 'invalid_email', 'Enter a valid email address.');
    await limit(`login-email:${await hash(email)}`, 1);
    await limit('login-global', 30);
    // Daily signup throttles: self-serve free accounts must not be mintable in bulk.
    const ip = await hash(req.headers.get('CF-Connecting-IP') || 'local');
    const known = await db()
      .prepare('SELECT 1 FROM accounts WHERE email=? AND deleted_at IS NULL')
      .bind(email)
      .first();
    if (!known) {
      await limit(`signup-ip-day:${ip}`, 5, DAY);
      await limit(`signup-domain-day:${await hash(email.split('@')[1])}`, 50, DAY);
    }
    const token = random(),
      browser = random(),
      tokenHash = await hash(token);
    await db().batch([
      db()
        .prepare('DELETE FROM login_links WHERE email=? OR expires_at<=?')
        .bind(email, Date.now()),
      db()
        .prepare(
          'INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES(?,?,?,?)',
        )
        .bind(tokenHash, email, await hash(browser), Date.now() + 15 * 60_000),
    ]);
    try {
      await settings().EMAIL!.send({
        from: 'login@bilaga.link',
        to: email,
        subject: 'Sign in to Bilaga',
        text: `Open this link in the same browser where you requested it, then confirm sign-in:\n\n${origin}/account#login=${token}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email.`,
      });
    } catch {
      await db()
        .prepare('DELETE FROM login_links WHERE hash=?')
        .bind(tokenHash)
        .run();
      return fail(
        503,
        'email_unavailable',
        'We could not send your sign-in email. Please try again later.',
      );
    }
    const response = json({
      message:
        'Check your email. Open the link in this browser within 15 minutes.',
    });
    setCookie(req, response, 'login', browser, 900);
    return response;
  }
  if (route === 'auth/verify' && method === 'POST') {
    await limit(
      `verify:${await hash(req.headers.get('CF-Connecting-IP') || 'local')}`,
      20,
    );
    const body = await bodyJson(req),
      browser = cookie(req, 'login');
    if (
      !/^[a-f0-9]{64}$/.test(body?.token || '') ||
      !/^[a-f0-9]{64}$/.test(browser)
    )
      return fail(
        400,
        'invalid_link',
        'Request a new link and open it in the same browser.',
      );
    // DELETE RETURNING makes simultaneous replay attempts consume the link once.
    const link = await db()
      .prepare(
        'DELETE FROM login_links WHERE hash=? AND browser_hash=? AND expires_at>? RETURNING email',
      )
      .bind(await hash(body.token), await hash(browser), Date.now())
      .first<{ email: string }>();
    if (!link)
      return fail(
        400,
        'invalid_link',
        'This link expired or was already used. Request a new one.',
      );
    const id = crypto.randomUUID().replaceAll('-', ''),
      token = random(),
      now = Date.now();
    const results = await db().batch([
      db()
        .prepare(
          'INSERT INTO accounts(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING',
        )
        .bind(id, link.email, now),
      db()
        .prepare(
          `INSERT INTO sessions(hash,account_id,created_at,expires_at) SELECT ?,id,?,? FROM accounts WHERE email=? AND deleted_at IS NULL RETURNING account_id`,
        )
        .bind(await hash(token), now, now + 30 * DAY, link.email),
    ]);
    if (!results[1].results.length)
      return fail(
        409,
        'account_changed',
        'Your account changed. Request a new sign-in link.',
      );
    const response = json({ signed_in: true });
    setCookie(req, response, 'session', token, 30 * 86400);
    setCookie(req, response, 'login', '', 0);
    return response;
  }
  if (route === 'auth/logout' && method === 'POST') {
    await db()
      .prepare('DELETE FROM sessions WHERE hash=?')
      .bind(await hash(cookie(req, 'session')))
      .run();
    const response = json({ signed_out: true });
    setCookie(req, response, 'session', '', 0);
    return response;
  }
  const account = await session(req);
  await limit(`account:${account.id}`, 60);
  if (route === 'account' && method === 'GET') {
    const tokens = (
      await db()
        .prepare(
          'SELECT id,label,created_at FROM api_tokens WHERE account_id=? ORDER BY created_at DESC',
        )
        .bind(account.id)
        .all()
    ).results;
    return json({
      email: account.email,
      uploads_enabled: !!account.uploads_enabled,
      limits: describeLimits(account.uploads_enabled ? TIERS.full : TIERS.free),
      billing: 'not_available',
      tokens,
    });
  }
  if (route === 'account/tokens' && method === 'POST') {
    const body = await bodyJson(req);
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label || label.length > 60)
      return fail(
        400,
        'invalid_label',
        'Name the agent using 1–60 characters.',
      );
    const token = `bilaga_${random()}`,
      id = crypto.randomUUID().replaceAll('-', '');
    const row = await db()
      .prepare(`INSERT INTO api_tokens(id,account_id,hash,label,created_at) SELECT ?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)
      AND (SELECT count(*) FROM api_tokens WHERE account_id=?)<10 RETURNING id`)
      .bind(
        id,
        account.id,
        await hash(token),
        label,
        Date.now(),
        account.id,
        account.id,
      )
      .first();
    if (!row)
      return fail(
        409,
        'token_limit',
        'Revoke an existing token before adding another.',
      );
    return json(
      {
        id,
        token,
        message: 'Save this token securely. It is shown only once.',
      },
      201,
    );
  }
  if (path.length === 3 && path[1] === 'tokens' && method === 'DELETE') {
    await db()
      .prepare('DELETE FROM api_tokens WHERE id=? AND account_id=?')
      .bind(path[2], account.id)
      .run();
    return json({ revoked: true });
  }
  if (route === 'account' && method === 'DELETE') {
    if (Date.now() - account.created_at > 15 * 60_000)
      return fail(
        403,
        'recent_login',
        'Sign in again before deleting your account.',
      );
    const body = await bodyJson(req);
    if (body?.confirmation !== account.email)
      return fail(
        400,
        'confirmation',
        'Type your email address to confirm deletion.',
      );
    // The transaction revokes links and credentials before any asynchronous storage work.
    await db().batch([
      db()
        .prepare(
          'UPDATE accounts SET email=NULL,deleted_at=?,uploads_enabled=0 WHERE id=?',
        )
        .bind(Date.now(), account.id),
      db().prepare('DELETE FROM sessions WHERE account_id=?').bind(account.id),
      db()
        .prepare('DELETE FROM api_tokens WHERE account_id=?')
        .bind(account.id),
      db().prepare('DELETE FROM login_links WHERE email=?').bind(account.email),
      db()
        .prepare(
          "UPDATE transfers SET state='deleted',filename='Deleted file',sender=NULL WHERE owner=?",
        )
        .bind(account.id),
    ]);
    const response = json(
      {
        deleted: true,
        message:
          'Your account and links are disabled. Stored files are queued for permanent removal.',
      },
      202,
    );
    setCookie(req, response, 'session', '', 0);
    return response;
  }
  return fail(404, 'not_found', 'Account endpoint not found.');
}
export async function cleanAccounts() {
  const now = Date.now();
  await db().batch([
    db().prepare('DELETE FROM login_links WHERE expires_at<=?').bind(now),
    db().prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
    // Keep tombstones briefly so requests already in flight can observe revocation.
    db()
      .prepare(`DELETE FROM transfers WHERE id IN (SELECT t.id FROM transfers t JOIN accounts a ON a.id=t.owner
      WHERE a.deleted_at<? AND t.purged_at IS NOT NULL LIMIT 100)`)
      .bind(now - DAY),
    db()
      .prepare(
        `DELETE FROM accounts WHERE deleted_at<? AND NOT EXISTS(SELECT 1 FROM transfers WHERE owner=accounts.id)`,
      )
      .bind(now - DAY),
  ]);
}
