'use client';
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import { Brand } from '@/app/brand';
import { request, retryRequest, uploadChunks } from '@/lib/client-api';
import { fileLabel } from '@/lib/rules';

type UploadedFile = { id: string; filename: string; size_bytes: number; status: string; part_size_bytes: number };
type Drop = {
  id: string; title: string; description: string; status: string; submitted_at: string | null;
  max_files: number; max_file_bytes: number; max_total_bytes: number; files: UploadedFile[];
};
export function RequestUpload({ id }: { id: string }) {
  const [data, setData] = useState<Drop | null>(null);
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const base = `/api/drop/${id}`;
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
    const controller = new AbortController();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      queueMicrotask(() => setMessage('This upload link is incomplete. Ask the requester for the full link.'));
      return;
    }
    queueMicrotask(() => setKey(token));
    request<Drop>(base, token, { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setMessage((e as Error).message);
    });
    return () => { controller.abort(); active.current?.abort(); };
  }, [base]);
  const refresh = () => request<Drop>(base, key).then(value => { setData(value); return value; });
  async function upload(files: File[]) {
    if (!data || active.current || !files.length) return;
    if (files.some(file => file.size <= 0 || file.size > data.max_file_bytes)) {
      setMessage(`Choose non-empty files no larger than ${fileLabel(data.max_file_bytes)} each.`);
      return;
    }
    setBusy(true); setMessage('');
    const controller = new AbortController(); active.current = controller;
    try {
      for (const file of files) {
        setProgress(`Starting ${file.name}…`);
        // Creation is not automatically retried: refresh reveals reservations
        // after a lost response, and the uploader can remove/re-add that file.
        const transfer = await request<UploadedFile>(`${base}/transfers`, key, {
          method: 'POST', body: JSON.stringify({ filename: file.name, size_bytes: file.size }), signal: controller.signal,
        });
        await refresh();
        await uploadChunks(file, transfer.part_size_bytes, controller.signal,
          (part, chunk) => request(`${base}/transfers/${transfer.id}/parts/${part}`, key, { method: 'PUT', body: chunk, signal: controller.signal }),
          percent => setProgress(`${file.name} · ${percent}%`));
        await retryRequest(() => request(`${base}/transfers/${transfer.id}/complete`, key, { method: 'POST', signal: controller.signal }), controller.signal);
        await refresh();
      }
      setMessage('Files uploaded. Add more, or click Done to finish your submission.');
    } catch (e) {
      setMessage(controller.signal.aborted ? 'Upload stopped. Remove any unfinished file below before trying again.' : (e as Error).message);
      await refresh().catch(() => {});
    } finally {
      active.current = null; setBusy(false); setProgress('');
      if (input.current) input.current.value = '';
    }
  }
  async function remove(file: UploadedFile) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await request(`${base}/transfers/${file.id}`, key, { method: 'DELETE' });
      await refresh();
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function done(event: { preventDefault(): void }) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      setData(await request<Drop>(`${base}/submit`, key, { method: 'POST', body: JSON.stringify({ email }) }));
    } catch (e) { setMessage((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const open = data?.status === 'open';
  const ready = !!data?.files.length && data.files.every(file => file.status === 'complete');
  return (
    <main className="shell">
      <header className="site-header"><Brand /><span className="small">A file request</span></header>
      <article className="docs-content account-content">
        <p className="eyebrow">SEND REQUESTED FILES</p>
        <h1>{data?.title || 'Upload your files.'}</h1>
        {message && <output className="notice">{message}</output>}
        {data?.description && <p style={{ whiteSpace: 'pre-wrap' }}>{data.description}</p>}
        {data?.status === 'submitted' ? (
          <section>
            <h2>Submission finished.</h2>
            <p>Your files were submitted on {new Date(data.submitted_at!).toLocaleString()}. The requester can now review them.</p>
            <p className="small">This records delivery of your files. The requester decides whether anything else is needed.</p>
          </section>
        ) : data && !open ? <p>This request has closed. Contact the requester for a new link.</p> : null}
        {open && <>
          <p>No account needed. Add all your files, then click <strong>Done</strong>. The requester covers the transfer.</p>
          <p className="small">Up to {data.max_files} files, {fileLabel(data.max_file_bytes)} per file and {fileLabel(data.max_total_bytes)} in total. Limits include removed files.</p>
          <label htmlFor="request-files">Choose files</label>
          <input id="request-files" ref={input} type="file" multiple disabled={busy} onChange={e => void upload(Array.from(e.target.files || []))} />
        </>}
        {!!data?.files.length && <ul aria-label="Files in this submission">
          {data.files.map(file => <li key={file.id} style={{ marginBottom: 12 }}>
            <strong>{file.filename}</strong> · {fileLabel(file.size_bytes)} · {file.status === 'complete' ? 'Uploaded' : file.status === 'expired' ? 'Expired' : 'Unfinished'}
            {open && <button type="button" className="account-button secondary" style={{ marginLeft: 12 }} disabled={busy} onClick={() => void remove(file)}>Remove</button>}
          </li>)}
        </ul>}
        {progress && <output>{progress}</output>}
        {progress && <button type="button" className="account-button secondary" onClick={() => active.current?.abort()}>Stop upload</button>}
        {open && <form onSubmit={done}>
          <label htmlFor="uploader-email">Your email</label>
          <input id="uploader-email" className="account-input" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
          <p className="small">Shared privately with the requester. Entering an email does not verify ownership of that address.</p>
          <button className="account-button" type="submit" disabled={busy || !ready}>Done — submit these files</button>
          <p className="small">After Done, this link cannot add or remove files. Finish or remove unfinished uploads first.</p>
        </form>}
        <p className="small"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
      </article>
    </main>
  );
}
