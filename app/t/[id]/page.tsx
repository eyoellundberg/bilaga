// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import {
  Download,
  ArrowUpRight,
  Clock,
  File,
  ShieldCheck,
  FileCheck,
  Reply,
} from 'lucide-react';
import { publicTransfer } from '@/lib/service';
import { fileLabel } from '@/lib/rules';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'A file for you — Bilaga',
  robots: { index: false, follow: false },
};
export default async function Recipient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const transfer = await publicTransfer(id);
  return (
    <main className="recipient-shell">
      <header className="site-header">
        <Brand />
        <span className="small">A simple handoff.</span>
      </header>
      <section className="recipient-content">
        <p className="eyebrow">
          {transfer
            ? 'THE FILE YOU WERE WAITING FOR'
            : 'THIS HANDOFF HAS ENDED'}
        </p>
        <h1>
          {transfer
            ? 'A little something for you.'
            : 'This file is unavailable.'}
        </h1>
        <p className="recipient-lede">
          {transfer
            ? 'Ready when you are. No account needed.'
            : 'The link may have expired, or the sender removed the file.'}
        </p>
        {transfer ? (
          <div className="recipient-card">
            <div className="file-heading">
              <div className="upload-icon">
                <File size={30} strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="filename">{transfer.filename}</h2>
                <p>
                  {fileLabel(transfer.size_bytes)}
                  {transfer.sender ? ` · From ${transfer.sender}` : ''}
                </p>
              </div>
            </div>
            <div className="recipient-details">
              <span>
                <Clock size={16} />
                Available until
              </span>
              <strong>
                {new Date(transfer.expires_at!).toLocaleString('en-GB', {
                  timeZone: 'UTC',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                UTC
              </strong>
            </div>
            <a
              className="download-action"
              href={`/api/download/${id}`}
              download
            >
              <Download size={19} />
              Download file
            </a>
            <p className="small recipient-note">
              Only download files from senders you trust.
            </p>
            {transfer.content_hash && (
              <p className="small recipient-note">
                <FileCheck size={14} />{' '}
                <a href={`/api/receipts/${id}`}>Signed receipt</a> · content
                hash <code>{transfer.content_hash.slice(0, 16)}…</code>
              </p>
            )}
          </div>
        ) : (
          <a className="download-action unavailable-action" href="/">
            Visit Bilaga <ArrowUpRight size={18} />
          </a>
        )}
        <p className="recipient-fine">
          <ShieldCheck size={16} />{' '}
          {transfer
            ? 'No sign-up. No subscription. Just your file.'
            : 'Ask the sender for a new link.'}
        </p>
      </section>
      {transfer && (
        <section className="recipient-reply">
          <p className="eyebrow">NEED TO SEND SOMETHING BACK?</p>
          <p>
            Sign in with your email, connect your agent, and it can send a file
            in minutes. Free for files up to 1 GB.
          </p>
          <a className="text-link" href="/account">
            <Reply size={16} /> Send a file back <ArrowUpRight size={16} />
          </a>
        </section>
      )}
      <footer>
        <span>Delivered with Bilaga.</span>
        <a href="/docs">
          Connect your agent <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
