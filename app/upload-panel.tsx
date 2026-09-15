'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  Paperclip,
  Check,
  Copy,
  ArrowUpRight,
  File,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { validSize, fileLabel } from '@/lib/rules';
import { request, uploadChunks } from '@/lib/client-api';

type Transfer = {
  id: string;
  filename: string;
  share_url: string;
  expires_at: string;
  download_requests: number;
  last_download_requested_at: string | null;
  sent_at: string | null;
  part_size_bytes: number;
};
export default function UploadPanel() {
  const [file, setFile] = useState<File | null>(null),
    [token, setToken] = useState(''),
    [to, setTo] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<Transfer | null>(null),
    [drag, setDrag] = useState(false),
    [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null),
    activeId = useRef<string | null>(null);
  function choose(f: File | undefined) {
    if (!f) return;
    if (!validSize(f.size)) {
      setError('Choose a non-empty file up to 50 GB.');
      return;
    }
    setFile(f);
    setError('');
    setResult(null);
    setProgress(0);
  }
  const api = useCallback(
    <T,>(path: string, method = 'GET', body?: BodyInit, signal?: AbortSignal) =>
      request<T>(path, token, { method, body, signal }),
    [token],
  );
  async function send() {
    if (!file || !token.trim() || busy) return;
    setBusy(true);
    setError('');
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const transfer = await api<Transfer>(
        '/api/transfers',
        'POST',
        JSON.stringify({
          filename: file.name,
          size_bytes: file.size,
          ...(to.trim() ? { to: to.trim() } : {}),
        }),
        controller.signal,
      );
      activeId.current = transfer.id;
      await uploadChunks(
        file,
        transfer.part_size_bytes,
        controller.signal,
        (part, chunk) =>
          api(
            `/api/transfers/${transfer.id}/parts/${part}`,
            'PUT',
            chunk,
            controller.signal,
          ),
        setProgress,
      );
      const ready = await api<Transfer>(
        `/api/transfers/${transfer.id}/complete`,
        'POST',
        undefined,
        controller.signal,
      );
      setResult(ready);
      setProgress(100);
      activeId.current = null;
    } catch (e) {
      setError(
        abort.current?.signal.aborted
          ? 'Upload cancelled.'
          : (e as Error).message,
      );
      if (activeId.current) {
        try {
          await api(`/api/transfers/${activeId.current}`, 'DELETE');
        } catch {
          /* Server expires unfinished uploads after 24 hours. */
        }
        activeId.current = null;
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const resultId = result?.id;
  const refresh = useCallback(async () => {
    const target = resultId;
    if (!target) throw new Error('Upload a file first.');
    const current = await api<Transfer>(`/api/transfers/${target}`);
    setResult(current);
    return {
      id: current.id,
      download_requests: current.download_requests,
      sent_at: current.sent_at,
      expires_at: current.expires_at,
    };
  }, [api, resultId]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: unknown,
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'check_current_transfer',
            title: 'Check current transfer',
            description:
              'Refresh download-request and sent status for the transfer currently shown in Bilaga. Requires a test token already entered in the page.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async (value: unknown) => {
              if (
                !value ||
                typeof value !== 'object' ||
                Array.isArray(value) ||
                Object.keys(value).length
              )
                throw new Error('Expected an empty object.');
              return await refresh();
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [refresh]);
  const expires = result
    ? new Date(result.expires_at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return (
    <div className="transfer-card">
      <div className="card-top">
        <span>{result ? 'READY TO SHARE' : 'NEW TRANSFER'}</span>
        <span className="mono">
          {result ? '03 / SHARE' : busy ? '02 / UPLOAD' : '01 / SELECT'}
        </span>
      </div>
      {result ? (
        <div className="result-panel">
          <div className="upload-icon success-icon">
            <Check size={30} />
          </div>
          <h2>Your file has a link.</h2>
          <p className="filename">{result.filename}</p>
          <p className="small">Available until {expires}</p>
          <div className="share-field">
            <Input
              aria-label="Shareable download link"
              value={result.share_url}
              readOnly
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy download link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.share_url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError('Select and copy the link above.');
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <a
            className="download-action"
            href={result.share_url}
            target="_blank"
            rel="noreferrer"
          >
            Open recipient page <ArrowUpRight size={17} />
          </a>
          <div className="status-line">
            <span>
              {result.download_requests
                ? `${result.download_requests} download request${result.download_requests === 1 ? '' : 's'}`
                : 'No download requests yet'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh download status"
              onClick={() => refresh().catch((e) => setError(e.message))}
            >
              <RefreshCw size={16} />
            </Button>
          </div>
          <p className="small">
            A request means a download started, not that it finished.
          </p>
          <Button
            className="another"
            variant="outline"
            onClick={() => {
              setResult(null);
              setFile(null);
              setProgress(0);
              setError('');
            }}
          >
            Send another file
          </Button>
        </div>
      ) : (
        <div
          className={`upload-body ${drag ? 'drag-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) choose(e.dataTransfer.files[0]);
          }}
        >
          <div className="dropzone">
            <div className="upload-icon">
              {file ? (
                <File size={30} strokeWidth={1.5} />
              ) : (
                <Upload size={30} strokeWidth={1.5} />
              )}
            </div>
            <h2>
              {file ? 'Ready for the handoff.' : 'Give your file a link.'}
            </h2>
            <p className="filename">
              {file ? file.name : 'Drop a file here to get started.'}
            </p>
            {file ? (
              <span className="small">
                {fileLabel(file.size)} · available for 30 days
              </span>
            ) : null}
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => choose(e.target.files?.[0])}
              disabled={busy}
            />
            {!busy ? (
              <Button
                className={file ? 'choose-another' : 'action'}
                variant={file ? 'ghost' : 'default'}
                onClick={() => input.current?.click()}
              >
                {file ? 'Choose a different file' : 'Choose a file'}
              </Button>
            ) : null}
            {!file ? (
              <span className="small">Up to 50 GB · free to send</span>
            ) : null}
          </div>
          {file ? (
            <div className="upload-controls">
              <label htmlFor="test-token">Test access token</label>
              <Input
                id="test-token"
                type="password"
                autoComplete="off"
                value={token}
                disabled={busy}
                onChange={(e) => setToken(e.target.value)}
                placeholder="bilaga_test_…"
                spellCheck={false}
              />
              <p className="small">
                Kept in this page’s memory. Never added to your link.
              </p>
              <label htmlFor="recipient-email">Recipient email (optional)</label>
              <Input
                id="recipient-email"
                type="email"
                autoComplete="off"
                value={to}
                disabled={busy}
                onChange={(e) => setTo(e.target.value)}
                placeholder="them@example.com"
                spellCheck={false}
              />
              <p className="small">
                Addressed files appear in that person’s Bilaga inbox, and your
                receipt records when their agent picks it up.
              </p>
              {busy ? (
                <>
                  <Progress
                    value={progress}
                    aria-label="File upload progress"
                  />
                  <div className="status-line">
                    <span>Uploading · {progress}%</span>
                    <Button
                      variant="ghost"
                      onClick={() => abort.current?.abort()}
                    >
                      <X size={15} />
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  className="action wide"
                  disabled={!token.trim()}
                  onClick={send}
                >
                  Upload & create link <ArrowUpRight size={16} />
                </Button>
              )}
            </div>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="card-bottom">
        <Paperclip size={16} />
        <span>
          {result
            ? 'Anyone with this link can download.'
            : 'Sending is free. No payment required.'}
        </span>
      </div>
    </div>
  );
}
