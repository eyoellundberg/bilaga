// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { ConnectAgent } from '@/app/connect-agent';
import { Brand } from '@/app/brand';
import { ArrowUpRight, Terminal } from 'lucide-react';
import {
  CREDIT_VALIDITY_YEARS,
  FREE_MONTHLY_TRANSFERS,
  FREE_STORED_BYTES,
  MAX_BYTES,
  MAX_STORED_BYTES,
  MINIMUM_CHARGE_CENTS,
  PRICE_CENTS_PER_GB,
  TOP_UP_PACKS,
  gbLabel,
  usd,
} from '@/lib/rules';
const packs = TOP_UP_PACKS.map((p) => `${p.name} is ${usd(p.amount_cents)} for up to ${p.up_to_gb} GB`).join(', ');
export const metadata = { title: 'Connect your agent — Bilaga' };
const endpoints = [
  ['GET /api/config', 'See upload limits and availability.'],
  [
    'GET /api/quote?bytes=…',
    'Estimate the future storage price. Storage is not charged yet.',
  ],
  [
    'POST /api/transfers',
    'Create an upload with a filename and size in bytes.',
  ],
  [
    'PUT /api/transfers/{id}/parts/{n}',
    'Upload one binary chunk. Retry failed chunks.',
  ],
  [
    'POST /api/transfers/{id}/complete',
    'Finish the upload and receive the shareable link.',
  ],
  [
    'GET /api/transfers/{id}',
    'Check uploaded parts, expiry, and download requests.',
  ],
  [
    'POST /api/transfers/{id}/sent',
    'Record that your agent delivered the link.',
  ],
  ['DELETE /api/transfers/{id}', 'Revoke the link and delete the stored file.'],
  [
    'GET /api/receipts/{public_id}',
    'Signed receipt with the content hash. No token needed.',
  ],
  ['GET /api/inbox', 'Transfers addressed to your account email.'],
  [
    'POST /api/inbox/{public_id}/received',
    'Acknowledge a transfer addressed to you; the sender’s receipt records it.',
  ],
  ['GET /api/events', 'Your signed event feed. Page with ?since=EVENT_ID.'],
  [
    'PUT /api/webhook',
    'Register one https URL to receive every event, signed with the receipt key.',
  ],
  ['POST /api/inbox/{public_id}/pay', 'Pay for a priced transfer from your balance.'],
  ['GET /api/balance', 'Your balance in cents and recent ledger entries.'],
];
export default function Docs() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/">
            Send a file <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">FOR YOUR AGENT</p>
        <h1>Connect your agent.</h1>
        <p>
          Let your agent upload the file and bring back a download link.
          Recipients don’t need an account.
        </p>
        <ol className="connection-steps">
          <li>
            <strong>Get your access token.</strong>{' '}
            <a href="/account">Sign in to your account</a> and create an agent
            token. Free accounts can send right away.
          </li>
          <li>
            <strong>Give your agent the details below.</strong> It will guide
            you through saving the token securely.
          </li>
          <li>
            <strong>Ask it to send a file.</strong> Your agent uploads it and
            gives you a link to share.
          </li>
        </ol>
        <p className="notice">
          {`Free: ${FREE_MONTHLY_TRANSFERS} transfers a month, files up to ${gbLabel(FREE_STORED_BYTES)}. Need more? ${packs}, files up to ${gbLabel(MAX_BYTES)}. Pay per use, never a subscription.`}
        </p>
        <ConnectAgent />
        <details className="agent-details">
          <summary>Technical setup and API reference</summary>
          <h2>Start with a file</h2>
          <p>
            Use the{' '}
            <a href="/bilaga.py" download>
              Python client
            </a>{' '}
            with Python 3.10 or later. It uses the standard library and retries
            failed chunks. Inspect the downloaded script before running it. Set{' '}
            <code>BILAGA_TOKEN</code> in your environment, then replace the
            filename below.
          </p>
          <pre>{`python3 bilaga.py \\\n  --base https://bilaga.link \\\n  --file report.pdf`}</pre>
          <p>
            The response includes the shareable link and expiry. Your agent
            delivers that link through its existing conversation or
            communication channel.
          </p>
          <h2>Upload in chunks and resume</h2>
          <p>
            Files upload sequentially in 8 MiB chunks. Save the transfer ID
            printed by the client. After interruption, keep the original file
            unchanged and resume within 24 hours:
          </p>
          <pre>{`python3 bilaga.py --base https://bilaga.link --file report.pdf --resume TRANSFER_ID`}</pre>
          <p>
            Resume skips confirmed parts only and retries unfinished parts.
            Changing a previously submitted chunk is rejected. The browser
            retries chunks while the page stays open; it does not resume after
            page closure.
          </p>
          <h2>Check the handoff</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --status TRANSFER_ID`}</pre>
          <p>
            Poll at most once every 15 seconds. A download request means a
            download started; it doesn’t prove completion or that a human read
            the file. Bilaga only marks a transfer “sent” when the agent reports
            delivery.
          </p>
          <h2>Prove the handoff</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --receipt PUBLIC_ID --verify downloaded-file`}</pre>
          <p>
            Every completed transfer has a receipt signed by Bilaga: content
            hash, size, sender, and timestamps. Anyone can verify it offline
            against the published key, with or without the file. It proves
            what was stored, not that a person read it. Receipts are kept
            after the file expires or is deleted, and{' '}
            <code>--receipt-hash FILE</code> finds the receipts for any file
            you hold, whoever sent it. The exact formats and
            verification steps are on the <a href="/verify">verification page</a>.
          </p>
          <h2>Address a file to another agent</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --file report.pdf --to them@example.com`}</pre>
          <p>
            An addressed transfer appears in the recipient’s inbox as soon as
            they sign in with that email, even if they have no account yet.
            Their agent lists it with <code>--inbox</code>, downloads it with{' '}
            <code>--download PUBLIC_ID</code>, and can answer with{' '}
            <code>--file answer.pdf --reply-to PUBLIC_ID</code>. When the
            recipient’s agent downloads or acknowledges the file, your receipt
            gains their account handle and a received time. Replies reference
            the original in their receipts, so a conversation of files is a
            chain of signed receipts.
          </p>
          <h2>Put a price on a file (experimental)</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --file dataset.parquet --to them@example.com --price 250`}</pre>
          <p>
            A priced transfer must be addressed. The recipient sees the price
            on the download page and in their inbox, and their agent pays with{' '}
            <code>--pay PUBLIC_ID</code> from its balance. Only then does the
            file download. Bilaga moves the money, keeps 5%, and signs the
            settlement into the receipt as <code>paid_at</code>,{' '}
            <code>paid_by_account</code>, and <code>fee_cents</code>. Check
            what you have with <code>--balance</code>. Card top-ups are available on the account page when payments are enabled.
          </p>
          <h2>Hear about it without polling</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --webhook https://your-agent.example/bilaga`}</pre>
          <p>
            Bilaga posts each event to your webhook as JSON, signed with the
            same Ed25519 key as receipts, and retries failures for about half
            a day. Events: <code>transfer.completed</code>,{' '}
            <code>transfer.downloaded</code> (first download),{' '}
            <code>transfer.received</code>, <code>transfer.reply</code>,{' '}
            <code>transfer.paid</code>, and <code>transfer.deleted</code>. Pipe a delivery to{' '}
            <code>--verify-event</code> to check it, or read the same events
            from <code>--events</code> if you would rather poll.
          </p>
          <h2>A small API, end to end</h2>
          <p>
            Send your token as <code>Authorization: Bearer …</code>. Keep it
            private: all tokens for an account can manage that account’s
            transfers. Recipient links never contain the token.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(([endpoint, detail]) => (
                  <tr key={endpoint}>
                    <td>{endpoint}</td>
                    <td>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <h2>What it costs</h2>
        <p>
          {`Every account gets ${FREE_MONTHLY_TRANSFERS} transfers per rolling 30 days and ${gbLabel(FREE_STORED_BYTES)} stored free, so a free file is at most ${gbLabel(FREE_STORED_BYTES)}. Beyond that, a transfer is charged when it is created at ${usd(PRICE_CENTS_PER_GB)} per decimal GB with a ${usd(MINIMUM_CHARGE_CENTS)} minimum, rounded up to a cent, from a balance you add to by card on the account page: ${TOP_UP_PACKS.map((p) => `${p.name} is ${usd(p.amount_cents)} for ${usd(p.credit_cents)} of credit (up to ${p.up_to_gb} GB)`).join(', ')}. Both are one-time payments valid for ${CREDIT_VALIDITY_YEARS} years; the minimum charge means many small transfers cover fewer GB. An upload that never completes is refunded to its original credit, without extending expiry or restoring expired portions. Oldest credit is used first; the account page shows expiry dates and we email a reminder 30 days before unused credit expires. Stored files count until they expire or you delete them, up to ${gbLabel(MAX_STORED_BYTES)}. Priced transfers, where a recipient pays the sender, exist in the API but are not a launch feature.`}
        </p>
        <a className="doc-file" href="/llms.txt">
          <Terminal size={18} />
          Read the complete agent instructions <ArrowUpRight size={16} />
        </a>
      </article>
      <footer>
        <span>bilaga / File delivery for agents.</span>
        <a href="/">
          Back to Bilaga <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
