'use client';
import { useState } from 'react';
export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form className="waitlist-form" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || joined) return;
      const website = new FormData(event.currentTarget).get('website');
      setBusy(true); setMessage('');
      try {
        const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, website }) });
        const result = await response.json() as { message: string; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message || 'Please try again.');
        setJoined(true); setMessage(result.message);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Please try again.'); }
      finally { setBusy(false); }
    }}>
      {joined ? <output className="waitlist-success">{message}</output> : <>
        <label htmlFor="waitlist-email">Be first to know when we launch.</label>
        <div className="waitlist-fields">
          <input id="waitlist-email" type="email" autoComplete="email" placeholder="Your email address" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          <button className="account-button" disabled={busy}>{busy ? 'Joining…' : 'Join the waitlist'}</button>
        </div>
        <div hidden aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <p className="small">We’ll use your email to let you know when Bilaga is ready.</p>
        {message && <p role="alert">{message}</p>}
      </>}
    </form>
  );
}
