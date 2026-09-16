'use client';
import { gbLabel, type describeLimits } from '@/lib/rules';
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { Brand } from '../brand';
import { RequestManager } from './request-manager';

type Account = {
  email: string;
  handle: string | null;
  balance_cents: number;
  credit_lots: { id: string; source: string; remaining_cents: number; expires_at: number | null }[];
  last_login_method: string | null;
  inbox_count: number;
  download_requests_total: number;
  receipt_requests_total: number;
  webhook_url: string | null;
  limits: ReturnType<typeof describeLimits>;
  top_ups: 'stripe_checkout' | 'unavailable';
  tokens: { id: string; label: string; created_at: number }[];
};
const setupCommand = (token: string) =>
  `npx -y bilaga-mcp setup ${token} && claude mcp add -s user bilaga -- npx -y bilaga-mcp`;
export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loginToken, setLoginToken] = useState('');
  const [agentToken, setAgentToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [methods, setMethods] = useState<{ email: boolean; google: boolean }>({ email: true, google: false });
  const [lastUsed, setLastUsed] = useState<'email' | 'google' | ''>('');
  async function api<T = { message: string; token: string }>(
    path: string,
    method: string = 'GET',
    body?: object,
  ) {
    const res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message || 'Please try again.');
    return data;
  }
  useEffect(() => {
    const readLogin = () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('login');
      if (token) {
        queueMicrotask(() => setLoginToken(token));
        history.replaceState(null, '', '/account');
      }
    };
    readLogin();
    const hashParams = new URLSearchParams(location.hash.slice(1));
    const failure = hashParams.get('error');
    const topup = hashParams.get('topup');
    if (failure || topup) {
      queueMicrotask(() =>
        setMessage(
          failure ||
            (topup === 'ok'
              ? 'Payment received. Your balance updates within a few seconds.'
              : 'Top-up cancelled. Nothing was charged.'),
        ),
      );
      history.replaceState(null, '', '/account');
    }
    try {
      const last = document.cookie.match(/(?:^|; )bilaga_last=(email|google)/)?.[1];
      if (last) queueMicrotask(() => setLastUsed(last as 'email' | 'google'));
    } catch {
      // Cookie access can be blocked; the hint is optional.
    }
    fetch('/api/auth/methods', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.ok) setMethods(await res.json());
      })
      .catch(() => {});
    window.addEventListener('hashchange', readLogin);
    window.addEventListener('popstate', readLogin);
    // Some embedded browsers update history without firing hashchange.
    const loginWatch = window.setInterval(readLogin, 250);
    fetch('/api/account', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.ok) setAccount(await res.json());
        else if (res.status !== 401)
          setMessage(
            'Account details are temporarily unavailable. Please reload.',
          );
      })
      .catch(() => setMessage('Could not connect. Please reload.'))
      .finally(() => setBusy(false));
    return () => {
      window.removeEventListener('hashchange', readLogin);
      window.removeEventListener('popstate', readLogin);
      window.clearInterval(loginWatch);
    };
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/">Send a file</a>
          <a href="/docs">For agents</a>
        </nav>
      </header>
      <article className="docs-content account-content">
        <p className="eyebrow">YOUR BILAGA</p>
        <h1>{account ? 'Your account.' : 'Sign in.'}</h1>
        {message && <output className="notice">{message}</output>}
        {loginToken ? (
          <section>
            <p>
              Confirm to sign in with the email link you requested. Links work
              once and expire after 15 minutes.
            </p>
            <button
              className="account-button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api('auth/verify', 'POST', { token: loginToken });
                  setLoginToken('');
                  setAccount(await api<Account>('account'));
                })
              }
            >
              Confirm sign-in
            </button>
            <button
              className="account-button secondary"
              disabled={busy}
              onClick={() => setLoginToken('')}
            >
              Request a new link
            </button>
          </section>
        ) : !account ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const data = await api('auth/request', 'POST', { email });
                setMessage(data.message);
              });
            }}
          >
            <p>
              Create an account or sign in. No password needed.
            </p>
            {methods.google && (
              <p>
                <a className="account-button secondary google-button" href="/api/auth/google">
                  Continue with Google
                  {lastUsed === 'google' && <span className="last-used">Last used</span>}
                </a>
              </p>
            )}
            <label htmlFor="email">
              Email address
              {lastUsed === 'email' && <span className="last-used">Last used</span>}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="account-button" disabled={busy}>
              Email me a sign-in link
            </button>
            <p className="small">
              Open the email link in this browser. Read our{' '}
              <a href="/privacy">privacy policy</a> and{' '}
              <a href="/terms">terms</a>.
            </p>
          </form>
        ) : (
          <>
            <p>
              Signed in as <strong>{account.email}</strong>.
            </p>
            <p className="notice">
              {`Free: ${gbLabel(account.limits.free_stored_bytes)} stored and ${account.limits.free_transfers_per_30_days} transfers per 30 days, files up to ${gbLabel(account.limits.max_file_bytes)}, ${account.limits.retention_days} days to download. Beyond that, $${(account.limits.price_cents_per_gb / 100).toFixed(2)} per GB ($${(account.limits.minimum_charge_cents / 100).toFixed(2)} minimum) from your balance, up to ${gbLabel(account.limits.max_stored_bytes)} stored.`}
            </p>
            <section>
              <h2>Your handle</h2>
              <p>
                <code>{account.handle ?? '—'}</code> identifies you in signed
                receipts and inbox listings, never your email. Files addressed
                to {account.email} land in your inbox
                {account.inbox_count
                  ? `, which holds ${account.inbox_count} right now`
                  : ''}
                . Your agent reads it with <code>--inbox</code>. Across your
                transfers, downloads have been requested{' '}
                {account.download_requests_total} times and receipts{' '}
                {account.receipt_requests_total} times.
                {account.webhook_url
                  ? ` Events are posted to ${account.webhook_url}.`
                  : ' No webhook is registered; your agent can add one with --webhook.'}
              </p>
            </section>
            <section>
              <h2>Balance</h2>
              <p>
                <strong>${(account.balance_cents / 100).toFixed(2)}</strong> in credit.
                {` ${account.limits.top_up_packs.map((p) => `${p.name} is $${p.amount_cents / 100} for $${p.credit_cents / 100} of credit (up to ${p.up_to_gb} GB)`).join('; ')}. Paid once, valid for ${account.limits.credit_validity_years} years, never a subscription.`}
              </p>
              {account.credit_lots.length > 0 && (
                <ul className="small">
                  {account.credit_lots.map((lot) => (
                    <li key={lot.id}>
                      ${(lot.remaining_cents / 100).toFixed(2)}
                      {lot.source === 'promotion' ? ' promotional credit' : ' credit'}
                      {lot.expires_at ? ` · expires ${new Date(lot.expires_at).toISOString().slice(0, 10)} (UTC)` : ' · no expiry'}
                    </li>
                  ))}
                </ul>
              )}
              <p className="small">Oldest credit is used first. We email a reminder 30 days before unused credit expires.</p>
              {account.top_ups === 'stripe_checkout' ? (
                <p>
                  {account.limits.top_up_packs.map((pack) => (
                    <button
                      key={pack.amount_cents}
                      className="account-button"
                      disabled={busy}
                      style={{ marginRight: 8 }}
                      onClick={() =>
                        act(async () => {
                          const { url } = await api<{ url: string }>('account/topup', 'POST', { amount_cents: pack.amount_cents });
                          location.assign(url);
                        })
                      }
                    >
                      {`${pack.name} · $${pack.amount_cents / 100}`}
                    </button>
                  ))}
                </p>
              ) : (
                <p className="small">Card top-ups are not enabled yet.</p>
              )}
            </section>
            <RequestManager />
            <details>
              <summary>Agent access: tokens and MCP</summary>
              <p>
                Click below to create a token. Each token gives an agent access
                to your transfers. Save it securely; you can revoke it here
                anytime. Other clients are covered on the{' '}
                <a href="/mcp">MCP page</a>.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    setAgentToken('');
                    const data = await api('account/tokens', 'POST', {
                      label: `Agent ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
                    });
                    setAgentToken(data.token);
                    setAccount(await api<Account>('account'));
                  });
                }}
              >
                <button className="account-button" disabled={busy}>
                  Connect an agent
                </button>
              </form>
              {agentToken && (
                <div className="notice">
                  <p>
                    Shown only once. Store this token in your agent’s secure
                    settings.
                  </p>
                  <code className="token-value">{agentToken}</code>
                  <button
                    className="account-button"
                    onClick={() =>
                      act(async () => {
                        await navigator.clipboard.writeText(agentToken);
                        setMessage('Token copied.');
                      })
                    }
                  >
                    Copy token
                  </button>
                  <p>
                    Using Claude Code? Paste this one line in a terminal and
                    you are done. It stores the token on your machine and adds
                    the Bilaga MCP server.
                  </p>
                  <code className="token-value">{setupCommand(agentToken)}</code>
                  <button
                    className="account-button"
                    onClick={() =>
                      act(async () => {
                        await navigator.clipboard.writeText(setupCommand(agentToken));
                        setMessage('Setup command copied.');
                      })
                    }
                  >
                    Copy setup command
                  </button>
                  <button
                    className="account-button secondary"
                    onClick={() => setAgentToken('')}
                  >
                    Hide token
                  </button>
                </div>
              )}
              <ul className="account-tokens">
                {account.tokens.map((t) => (
                  <li key={t.id}>
                    <span>{t.label}</span>
                    <button
                      className="account-button secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await api(`account/tokens/${t.id}`, 'DELETE');
                          setAgentToken('');
                          setAccount(await api<Account>('account'));
                        })
                      }
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
              <p>
                <a href="/docs">Read the agent setup instructions →</a>
              </p>
            </details>
            <section>
              <h2>Sign out</h2>
              <button
                className="account-button secondary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api('auth/logout', 'POST');
                    setAccount(null);
                    setAgentToken('');
                  })
                }
              >
                Sign out of this browser
              </button>
            </section>
            <section>
              <h2>Delete account</h2>
              <p>
                This disables all your agent tokens and download links
                immediately, and queues your files for permanent deletion. This
                cannot be undone. Sign in again first if your last sign-in was
                more than 15 minutes ago.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const data = await api('account', 'DELETE', {
                      confirmation,
                    });
                    setAccount(null);
                    setAgentToken('');
                    setConfirmation('');
                    setMessage(data.message);
                  });
                }}
              >
                <label htmlFor="confirm">Type {account.email} to confirm</label>
                <input
                  id="confirm"
                  type="email"
                  autoComplete="off"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <button
                  className="account-button danger"
                  disabled={busy || confirmation !== account.email}
                >
                  Permanently delete my account
                </button>
              </form>
            </section>
          </>
        )}
      </article>
    </main>
  );
}
