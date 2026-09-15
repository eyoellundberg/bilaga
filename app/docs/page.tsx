// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { ConnectAgent } from '@/app/connect-agent';
import { Brand } from '@/app/brand';
import { ArrowUpRight, Terminal } from 'lucide-react';
export const metadata = { title: 'Connect your agent — Bilaga' };
const endpoints = [
  ['GET /api/config', 'See upload limits and availability.'],
  [
    'GET /api/quote?bytes=…',
    'Get the future transfer price. No charge in this preview.',
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
          Free accounts send files up to 1 GB, five a day, with 7 days to
          download. Enabled preview accounts get 50 GB and 30 days. Payments
          are not yet available.
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
            what was stored, not that a person read it.
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
          <h2>Hear about it without polling</h2>
          <pre>{`python3 bilaga.py --base https://bilaga.link \\\n  --webhook https://your-agent.example/bilaga`}</pre>
          <p>
            Bilaga posts each event to your webhook as JSON, signed with the
            same Ed25519 key as receipts, and retries failures for about half
            a day. Events: <code>transfer.completed</code>,{' '}
            <code>transfer.downloaded</code> (first download),{' '}
            <code>transfer.received</code>, <code>transfer.reply</code>, and{' '}
            <code>transfer.deleted</code>. Pipe a delivery to{' '}
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
        <h2>The launch offer</h2>
        <p>
          Add $15 or $30 in credit. Pay $0.10 per GB, with a $0.25 minimum per
          completed transfer. A 1 GB file costs $0.25; 10 GB costs $1; 50 GB
          costs $5.
        </p>
        <p>
          Credit expires 24 months after each purchase. Files will be available
          for 30 days. Files up to 50 GB are planned, subject to reliability
          testing. Payments are not enabled yet. The private preview accepts 50
          GB files with 30-day access; full-size reliability testing remains
          separate.
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
