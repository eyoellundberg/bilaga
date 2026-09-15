// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import { ArrowUpRight } from 'lucide-react';
export const metadata = { title: 'Verifying Bilaga receipts and events' };
const receiptFields: [string, string][] = [
  ['version', 'Integer. Currently 1.'],
  ['issuer', 'Always "bilaga.link".'],
  ['transfer', 'Public transfer id: 32 lowercase hex characters.'],
  ['filename', 'The stored filename after sanitisation.'],
  ['size_bytes', 'Integer byte length of the stored file.'],
  ['part_size_bytes', 'Chunk size used for the content hash. Currently 8388608.'],
  ['content_hash', 'Hex SHA-256 over the concatenated raw SHA-256 digests of each chunk, in order.'],
  ['content_hash_algorithm', 'Always "bilaga-chunked-sha256-8mib".'],
  ['sender', 'Free-text sender label supplied by the uploader, or null.'],
  ['sender_account', 'Stable public handle of the sending account ("acct_…"), or null.'],
  ['addressed', 'Boolean: the transfer was addressed to a specific email.'],
  ['recipient_account', 'Handle of the account that acknowledged receipt, or null.'],
  ['received_at', 'ISO 8601 time of the first acknowledgement, or null.'],
  ['in_reply_to', 'Public id of the transfer this one replies to, or null.'],
  ['price_cents', 'Integer price set by the sender; 0 when free.'],
  ['fee_cents', 'Bilaga’s fee once paid, or null.'],
  ['paid_at', 'ISO 8601 time of settlement, or null.'],
  ['paid_by_account', 'Handle of the paying account, or null.'],
  ['completed_at', 'ISO 8601 time the upload completed.'],
  ['expires_at', 'ISO 8601 time the download link stops working.'],
  ['sent_reported_at', 'When the uploading agent reported delivery, or null.'],
  ['download_requests', 'Integer count of download requests at issue time.'],
  ['last_download_requested_at', 'ISO 8601 time or null.'],
  ['issued_at', 'ISO 8601 time this receipt was signed. Receipts are issued on request, so two receipts for one transfer differ here.'],
];
const eventFields: [string, string][] = [
  ['version', 'Integer. Currently 1.'],
  ['issuer', 'Always "bilaga.link".'],
  ['id', 'Time-ordered event id: "evt_" followed by 28 hex characters.'],
  ['type', 'One of transfer.completed, transfer.downloaded, transfer.received, transfer.reply, transfer.paid, transfer.deleted, webhook.test.'],
  ['occurred_at', 'ISO 8601 time.'],
  ['transfer', 'Object describing the transfer as the receiving account is allowed to see it, or null for webhook.test.'],
];
export default function Verify() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/docs">
            For agents <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">SPECIFICATION</p>
        <h1>Verifying receipts and events.</h1>
        <p>
          Bilaga signs two kinds of document: a <strong>receipt</strong> for
          every completed transfer and an <strong>event</strong> for every
          change on an account. Both use the same envelope, the same key, and
          the same canonical form, so one verifier handles both. Nothing here
          requires a Bilaga token or trusts Bilaga’s web pages.
        </p>
        <h2>1. The envelope</h2>
        <pre>{`{
  "receipt": { ...fields... },        // or "event": { ... }
  "signature_hex": "…128 hex chars…",
  "key_id": "…16 hex chars…",
  "public_key_hex": "…64 hex chars…",
  "algorithm": "ed25519",
  "canonicalization": "json-sorted-keys-no-whitespace-utf8",
  "verify_url": "/api/receipt-key"
}`}</pre>
        <p>
          The signature covers only the inner object. Everything else in the
          envelope is a hint for the verifier and must not be trusted on its
          own: in particular, do not verify against the <code>public_key_hex</code>{' '}
          in the envelope without first confirming it is Bilaga’s key.
        </p>
        <h2>2. Canonical form</h2>
        <p>
          Serialise the inner object as JSON with object keys sorted by Unicode
          code point at every level, no whitespace, UTF-8 encoded, non-ASCII
          characters written literally (not escaped), and integers written
          without exponent or fraction. Keys whose value is undefined are
          omitted; null values are kept. In Python:{' '}
          <code>{"json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)"}</code>.
          The message to verify is the UTF-8 bytes of that string.
        </p>
        <h2>3. The key</h2>
        <p>
          <code>GET https://bilaga.link/api/receipt-key</code> returns the
          current Ed25519 public key as <code>public_key_hex</code> (32 bytes,
          RFC 8032) with its <code>key_id</code>, which is the first 16 hex
          characters of SHA-256 over the raw public key bytes. A verifier
          should fetch the key once over TLS, pin it, and accept a document
          only when its <code>key_id</code> matches a pinned key. If Bilaga
          ever rotates the key, the endpoint lists earlier ids in{' '}
          <code>retired_key_ids</code>; documents signed by a retired key stay
          valid, documents signed by an unknown key do not.
        </p>
        <h2>4. Verify</h2>
        <ol>
          <li>Confirm <code>key_id</code> is the current or a retired Bilaga key id, and that <code>public_key_hex</code> matches the pinned key for that id.</li>
          <li>Compute the canonical bytes of the inner object.</li>
          <li>Check the Ed25519 signature <code>signature_hex</code> over those bytes with the pinned public key.</li>
          <li>For a receipt, check that <code>transfer</code> is the public id you expected and, if you hold the file, that its size and content hash match.</li>
          <li>For an event, check <code>issuer</code>, that <code>id</code> is one you have not processed, and then fetch current state from the API rather than acting on the event body alone.</li>
        </ol>
        <p>
          The shipped Python client does all of this with the standard library:{' '}
          <code>bilaga.py --receipt PUBLIC_ID --verify file</code> and{' '}
          <code>bilaga.py --verify-event &lt; body.json</code>. In a browser or
          Node, <code>{"crypto.subtle.verify({name:'Ed25519'}, key, sig, msg)"}</code>{' '}
          with the key imported as raw bytes is enough.
        </p>
        <h2>5. Content hash</h2>
        <p>
          Split the file into 8,388,608-byte chunks. Take the SHA-256 of each
          chunk. Concatenate those raw 32-byte digests in order and take the
          SHA-256 of the result; that hex string is <code>content_hash</code>.
          It is computed from the chunk hashes checked during upload, so it
          identifies the bytes Bilaga stored, and it lets a verifier check a
          large file in one streaming pass.
        </p>
        <h2>6. Receipt fields</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
            <tbody>{receiptFields.map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody>
          </table>
        </div>
        <h2>7. Event fields</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
            <tbody>{eventFields.map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody>
          </table>
        </div>
        <p>
          Webhook deliveries carry the envelope as the request body and repeat{' '}
          <code>signature_hex</code> and <code>key_id</code> in the{' '}
          <code>X-Bilaga-Signature</code> and <code>X-Bilaga-Key-Id</code>{' '}
          headers, with the event id in <code>X-Bilaga-Delivery</code>.
        </p>
        <h2>8. What a signature proves</h2>
        <p>
          A valid receipt proves that Bilaga stored a file with these bytes,
          size, and metadata, that the named accounts took the named actions,
          and that nobody altered the document afterwards. It does not prove
          that a human read the file, and it does not prove anything about
          the file’s contents beyond their hash. Fields may be added in later
          versions; verifiers should ignore fields they do not know and refuse
          documents whose <code>version</code> they do not understand.
        </p>
      </article>
      <footer>
        <span>bilaga / File delivery for agents.</span>
        <a href="/docs">
          Connect your agent <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
