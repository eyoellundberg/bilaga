# Optional end-to-end encryption (design note)

17 September 2026. Status: not started. Post-launch candidate.

## Where we are

Files are encrypted in transit (TLS) and at rest (Cloudflare R2 encrypts every object with AES-256). They are not end-to-end encrypted: Cloudflare holds the keys and Bilaga serves the original bytes to anyone holding the link. Public wording: "Encrypted in transit and at rest, not end-to-end. Encrypt first if it's secret."

## Proposal

An opt-in mode, off by default. The normal mode stays exactly as it is.

1. The sending client generates a random 256-bit key and encrypts the file locally, chunk by chunk (AES-256-GCM per 8 MiB upload part, nonce derived from the part number), before upload.
2. The key travels only in the share link's fragment: `https://bilaga.link/t/{public_id}#k={base64url key}`. Browsers never send the fragment to the server, so Bilaga and Cloudflare only ever hold ciphertext.
3. The download page sees `#k=`, streams the ciphertext, and decrypts in the browser. `bilaga.py` and `bilaga-mcp` decrypt when given the full link.
4. API: `POST /api/transfers` takes `"encryption": "client-aes256gcm-v1"`. The server stores the flag and nothing else. MCP: `send_file` takes `encrypt: true`.

## Why it is optional and not the default

- Browser decryption of files up to 50 GB needs a streaming path (service worker or File System Access). Safari is the weak spot. Plain downloads work everywhere, with pause and resume.
- Any HTTP client can fetch a normal transfer. An encrypted one needs a Bilaga client to be useful, including the recipient agent's inbox download.
- The link becomes the key. A link pasted into chat or email is readable by that channel. This protects against Bilaga and Cloudflare, not against a forwarded link.

## Receipts

`content_hash` is computed from the bytes Bilaga stored, so for an encrypted transfer it covers the ciphertext. To keep "verify this file against its receipt" working:

- The client sends `plaintext_hash` (same `bilaga-chunked-sha256-8mib` algorithm over the original file) at creation.
- The receipt carries both, with `plaintext_hash` marked `sender_claimed: true`. Bilaga signs that the sender claimed it, not that it is true.
- `GET /api/receipts?hash=` matches either hash.
- `/verify` gets a section on the two hashes. `--verify` checks the ciphertext hash against Bilaga's signature and the plaintext hash against the decrypted file.

## Abuse and takedown

Bilaga cannot inspect an encrypted file, only delete it on report. /terms and /policy need a sentence saying so. A reporter who holds the full link can still show the content.

## Rules that still hold

- Never log, store, or accept the key server-side. Reject requests that carry `k=` in the query string.
- Priced, addressed, and reply transfers work unchanged; the sender puts the full link, with fragment, in whatever channel they already use. Inbox entries cannot include the key, so an addressed encrypted transfer needs the key delivered out of band. Decide before building whether that is acceptable or whether inbox delivery is refused for encrypted transfers.

## Order of work

1. Python client encrypt and decrypt, with tests against fixed vectors.
2. Server flag, `plaintext_hash`, receipt fields, `/verify` text.
3. `bilaga-mcp` `encrypt: true`.
4. Browser streaming decrypt on `/t/{id}`. Ship last; until then the page tells the recipient to use the client.
