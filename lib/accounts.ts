import { creditSummary } from './credits';
import { env } from 'cloudflare:workers';
import { sha256 } from './hash';
import { bodyJson, fail, json } from './http';
import { DAY, describeLimits } from './rules';
import { createCheckout, stripeConfigured } from './stripe';

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
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
// A signed-in browser gets a session cookie; the sign-in page also remembers
// which method was used last, in a plain cookie the page can read.
async function establishSession(req: Request, email: string, method: 'email' | 'google') {
  const id = crypto.randomUUID().replaceAll('-', ''),
    token = random(),
    now = Date.now();
  const results = await db().batch([
    db()
      .prepare(
        'INSERT INTO accounts(id,email,created_at,handle) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING',
      )
      .bind(id, email, now, `acct_${random().slice(0, 16)}`),
    db()
      .prepare(
        `INSERT INTO sessions(hash,account_id,created_at,expires_at) SELECT ?,id,?,? FROM accounts WHERE email=? AND deleted_at IS NULL RETURNING account_id`,
      )
      .bind(await hash(token), now, now + 30 * DAY, email),
    db()
      .prepare('UPDATE accounts SET last_login_method=? WHERE email=? AND deleted_at IS NULL')
      .bind(method, email),
  ]);
  if (!results[1].results.length) return null;
  return { token, method };
}
function rememberMethod(req: Request, response: Response, method: string) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.append(
    'Set-Cookie',
    `bilaga_last=${method}; Path=/account; SameSite=Lax; Max-Age=${365 * 86400}${secure}`,
  );
}
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeJwtPayload(jwt: string) {
  const part = jwt.split('.')[1] || '';
  const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
}
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
  handle: string | null;
  balance_cents: number;
  last_login_method: string | null;
};
async function session(req: Request) {
  const token = cookie(req, 'session');
  if (!/^[a-f0-9]{64}$/.test(token))
    return fail(401, 'sign_in', 'Sign in to manage your account.');
  const row = await db()
    .prepare(`SELECT a.id,a.email,s.created_at,a.handle,a.balance_cents,a.last_login_method FROM sessions s JOIN accounts a ON a.id=s.account_id
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
  if (route === 'auth/methods' && method === 'GET')
    return json({ email: !!settings().EMAIL, google: !!(settings().GOOGLE_CLIENT_ID && settings().GOOGLE_CLIENT_SECRET) });
  // Google sign-in: authorization code with PKCE, state bound to this browser.
  // The id_token comes straight from Google's token endpoint over TLS with the
  // client secret, so its claims are trusted without a second signature check.
  if (route === 'auth/google' && method === 'GET') {
    const { GOOGLE_CLIENT_ID } = settings();
    if (!GOOGLE_CLIENT_ID || !settings().GOOGLE_CLIENT_SECRET)
      return fail(503, 'google_unavailable', 'Google sign-in is not configured.');
    await limit(`login-ip:${await hash(req.headers.get('CF-Connecting-IP') || 'local')}`, 5);
    const state = random(),
      verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    const target = new URL(GOOGLE_AUTH);
    target.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    const response = new Response(null, { status: 302, headers: { Location: target.toString() } });
    setCookie(req, response, 'oauth', `${state}.${verifier}`, 600);
    return response;
  }
  if (route === 'auth/google/callback' && method === 'GET') {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = settings();
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
      return fail(503, 'google_unavailable', 'Google sign-in is not configured.');
    await limit(`verify:${await hash(req.headers.get('CF-Connecting-IP') || 'local')}`, 20);
    const params = new URL(req.url).searchParams;
    const [state, verifier] = cookie(req, 'oauth').split('.');
    const back = (message: string) =>
      new Response(null, {
        status: 303,
        headers: { Location: `${origin}/account#error=${encodeURIComponent(message)}` },
      });
    if (params.get('error')) return back('Google sign-in was cancelled.');
    if (!state || !verifier || params.get('state') !== state || !params.get('code'))
      return back('Sign-in did not match this browser. Try again.');
    let claims: { aud?: string; iss?: string; email?: string; email_verified?: boolean; exp?: number };
    try {
      const res = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: params.get('code')!,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${origin}/api/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as { id_token?: string };
      if (!res.ok || !data.id_token) throw new Error('token exchange failed');
      claims = decodeJwtPayload(data.id_token);
    } catch {
      return back('Google did not confirm the sign-in. Try again.');
    }
    const email = (claims.email || '').trim().toLowerCase();
    if (
      claims.aud !== GOOGLE_CLIENT_ID ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss || '') ||
      claims.email_verified !== true ||
      !email ||
      (claims.exp && claims.exp * 1000 < Date.now())
    )
      return back('Google returned an account without a verified email.');
    const established = await establishSession(req, email, 'google');
    if (!established) return back('Your account changed. Try again.');
    const response = new Response(null, { status: 303, headers: { Location: `${origin}/account` } });
    setCookie(req, response, 'session', established.token, 30 * 86400);
    setCookie(req, response, 'oauth', '', 0);
    rememberMethod(req, response, 'google');
    return response;
  }
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
    const established = await establishSession(req, link.email, 'email');
    if (!established)
      return fail(
        409,
        'account_changed',
        'Your account changed. Request a new sign-in link.',
      );
    const response = json({ signed_in: true });
    setCookie(req, response, 'session', established.token, 30 * 86400);
    setCookie(req, response, 'login', '', 0);
    rememberMethod(req, response, 'email');
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
    const [tokens, hook, totals, inbox, credits] = await Promise.all([
      db().prepare('SELECT id,label,created_at FROM api_tokens WHERE account_id=? ORDER BY created_at DESC')
        .bind(account.id).all().then((result) => result.results),
      db().prepare('SELECT url FROM webhooks WHERE account_id=?')
        .bind(account.id).first<{ url: string }>(),
      db().prepare('SELECT COALESCE(SUM(download_requests),0) AS downloads, COALESCE(SUM(receipt_requests),0) AS receipts FROM transfers WHERE owner=?')
        .bind(account.id).first<{ downloads: number; receipts: number }>(),
      db().prepare("SELECT count(*) AS n FROM transfers WHERE recipient=? AND state='complete' AND expires_at>?")
        .bind(account.email, Date.now()).first<{ n: number }>(),
      creditSummary(account.id),
    ]);
    return json({
      email: account.email,
      handle: account.handle,
      inbox_count: inbox?.n ?? 0,
      download_requests_total: totals?.downloads ?? 0,
      receipt_requests_total: totals?.receipts ?? 0,
      webhook_url: hook?.url ?? null,
      ...credits,
      last_login_method: account.last_login_method,
      limits: describeLimits(),
      top_ups: stripeConfigured() ? 'stripe_checkout' : 'unavailable',
      tokens,
    });
  }
  if (route === 'account/topup' && method === 'POST') {
    await limit(`topup:${account.id}`, 10);
    const body = await bodyJson(req);
    const amount = Number(body?.amount_cents);
    const session = await createCheckout(account.id, amount, origin);
    return json({ url: session.url, amount_cents: amount });
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
          'UPDATE accounts SET email=NULL,deleted_at=?,uploads_enabled=0,last_login_method=NULL WHERE id=?',
        )
        .bind(Date.now(), account.id),
      db().prepare('DELETE FROM sessions WHERE account_id=?').bind(account.id),
      db()
        .prepare('DELETE FROM api_tokens WHERE account_id=?')
        .bind(account.id),
      db().prepare('DELETE FROM login_links WHERE email=?').bind(account.email),
      db()
        .prepare(
          "UPDATE transfers SET state='deleted',filename='Deleted file',sender=NULL,recipient=NULL WHERE owner=?",
        )
        .bind(account.id),
      db()
        .prepare('UPDATE transfers SET recipient=NULL WHERE recipient=?')
        .bind(account.email),
      db().prepare('DELETE FROM webhooks WHERE account_id=?').bind(account.id),
      db().prepare('DELETE FROM events WHERE account_id=?').bind(account.id),
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
    // Transfer rows are kept as redacted receipt records; an account row with
    // transfers stays as an email-less tombstone so its handle keeps resolving.
    db()
      .prepare(
        `DELETE FROM accounts WHERE deleted_at<? AND NOT EXISTS(SELECT 1 FROM transfers WHERE owner=accounts.id)`,
      )
      .bind(now - DAY),
  ]);
}
