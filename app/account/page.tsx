'use client';
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { Brand } from '../brand';

type Account = {
  email: string;
  handle: string | null;
  balance_cents: number;
  last_login_method: string | null;
  inbox_count: number;
  download_requests_total: number;
  receipt_requests_total: number;
  webhook_url: string | null;
  limits: {
    max_file_bytes: number;
    max_stored_bytes: number;
    free_stored_bytes: number;
    free_transfers_per_30_days: number;
    retention_days: number;
  };
  top_ups: 'stripe_checkout' | 'unavailable';
  top_up_cents: number[];
  tokens: { id: string; label: string; created_at: number }[];
};
const gb = (bytes: number) => `${bytes / 1e9} GB`;
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
              <a href="/privacy">draft privacy policy</a> and{' '}
              <a href="/terms">draft terms</a>.
            </p>
          </form>
        ) : (
          <>
            <p>
              Signed in as <strong>{account.email}</strong>.
            </p>
            <p className="notice">
              {`Free: ${gb(account.limits.free_stored_bytes)} stored and ${account.limits.free_transfers_per_30_days} transfers per 30 days, files up to ${gb(account.limits.max_file_bytes)}, ${account.limits.retention_days} days to download. Beyond that, $0.10 per GB ($0.25 minimum) from your balance, up to ${gb(account.limits.max_stored_bytes)} stored.`}
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
                <strong>${(account.balance_cents / 100).toFixed(2)}</strong> USD.
                Transfers outside your free allowance are paid from here at
                $0.10 per GB. Credit does not expire.
              </p>
              {account.top_ups === 'stripe_checkout' ? (
                <p>
                  {account.top_up_cents.map((cents) => (
                    <button
                      key={cents}
                      className="account-button"
                      disabled={busy}
                      style={{ marginRight: 8 }}
                      onClick={() =>
                        act(async () => {
                          const { url } = await api<{ url: string }>('account/topup', 'POST', { amount_cents: cents });
                          location.assign(url);
                        })
                      }
                    >
                      {`Add $${cents / 100}`}
                    </button>
                  ))}
                </p>
              ) : (
                <p className="small">Card top-ups are not enabled yet.</p>
              )}
            </section>
            <details>
              <summary>Agent access</summary>
              <p>
                Each token gives an agent access to your transfers. Save it
                securely; you can revoke it here anytime.
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
