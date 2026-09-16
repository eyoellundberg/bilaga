'use client';
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { fileLabel } from '@/lib/rules';

type Item = { id: string; title: string; status: string; reference: string | null; submitted_at: string | null };
type Detail = Item & {
  uploader_email: string | null;
  files: { id: string; public_id: string; filename: string; size: number; state: string }[];
};
async function api<T>(path = '', method: string = 'GET', body?: object): Promise<T> {
  const res = await fetch(`/api/account/requests${path}`, { method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json() as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || 'Please try again.');
  return data;
}
export function RequestManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api<{ requests: Item[] }>().then(data => setItems(data.requests));
  useEffect(() => { void api<{ requests: Item[] }>().then(data => setItems(data.requests)).catch(e => setMessage(e.message)); }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <section>
    <h2>Request files</h2>
    <p>Collect files from someone without a Bilaga account. They can add multiple files and click Done when finished.</p>
    <p className="small">Each file uses your free allowance or credit at the normal transfer price. Done adds no charge. Links last 7 days and allow 20 files, up to 5 GB total. Removed files still count toward the request limits.</p>
    {message && <output className="notice">{message}</output>}
    <form onSubmit={e => { e.preventDefault(); void act(async () => {
      const result = await api<{ upload_url: string }>('', 'POST', { title, description });
      setLink(result.upload_url); setTitle(''); setDescription(''); await refresh();
    }); }}>
      <label htmlFor="request-title">What files do you need?</label>
      <input id="request-title" className="account-input" required maxLength={120} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="Files for your project" />
      <label htmlFor="request-description">Instructions (optional)</label>
      <textarea id="request-description" className="account-input" maxLength={1000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} />
      <button className="account-button" disabled={busy}>Create upload link</button>
    </form>
    {link && <div className="notice">
      <p>Save and share this complete link. Its secret key is shown only here. Anyone with it can add files until Done.</p>
      <input aria-label="Upload link" className="account-input" readOnly value={link} onFocus={e => e.target.select()} />
      <button type="button" className="account-button secondary" onClick={() => void act(async () => { await navigator.clipboard.writeText(link); setMessage('Link copied.'); })}>Copy link</button>
    </div>}
    {items.length > 0 && <ul>{items.map(item => <li key={item.id} style={{ marginBottom: 12 }}>
      <strong>{item.title}</strong> · {item.status}{item.submitted_at ? ` · ${new Date(item.submitted_at).toLocaleString()}` : ''}
      <button className="account-button secondary" disabled={busy} style={{ marginLeft: 12 }} onClick={() => void act(async () => setDetail(await api<Detail>(`/${item.id}`)))}>View files</button>
      {item.status === 'open' && <button className="account-button secondary" disabled={busy} onClick={() => void act(async () => { await api(`/${item.id}`, 'DELETE'); await refresh(); })}>Close request</button>}
    </li>)}</ul>}
    {detail && <div className="notice">
      <h3>{detail.title}</h3>
      {detail.uploader_email && <p>Submitted by {detail.uploader_email} (email supplied by the uploader; not verified).</p>}
      <ul>{detail.files.filter(file => file.state !== 'deleted').map(file => <li key={file.id}>
        {file.state === 'complete' ? <a href={`/api/download/${file.public_id}`}>{file.filename}</a> : file.filename} · {fileLabel(file.size)} · {file.state}
      </li>)}</ul>
      {detail.status === 'submitted' && <a href={`/api/account/requests/${detail.id}/receipt`} target="_blank" rel="noreferrer">Signed submission receipt</a>}
    </div>}
  </section>;
}
