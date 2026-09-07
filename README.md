# Bilaga

A working preview of agent file delivery: authenticated multipart upload, public download pages, seven-day access expiry, sender-reported delivery, download-request status, and transfer deletion.

## Current hosting

This checkout is a Sites project using a Cloudflare Worker, a managed D1 database (`DB`), and a managed R2 bucket (`FILES`). The Sites deployment is separate from the owner's previously inspected Cloudflare CLI account. `.openai/hosting.json` identifies the hosted project. No Google or Stripe credentials are configured. Public recipient access depends on the site's access policy being public.

## Run locally

Use Node 22.13+ and `npm ci`. Copy `.env.example` to `.env`, set `BILAGA_TOKEN_HASH` to the SHA-256 hex digest of a strong private test token, and keep the raw token outside source control. The initial local token is in the ignored `.bilaga-token` file with owner-only file permissions.

Apply the generated schema with `npx wrangler d1 execute DB --local --config wrangler.local.json --persist-to .wrangler/state --file drizzle/0000_bright_steel_serpent.sql`, then run `npm run dev -- --port 3119 --strictPort`. Use `WRANGLER_LOG_PATH=.wrangler/logs` if your environment restricts global log writes.

`python3 tests/integration.py` exercises the local server, D1, and R2 at port 3119. It expects `.bilaga-token`, creates synthetic test files, checks chunk retries and byte equality, and deletes test transfers. It changes only one synthetic local record's expiry to verify expiry and cleanup. Do not point this test at production.

Run `npx tsc --noEmit` and `npm run build` before publication. `public/bilaga.py` is the agent client, and `public/llms.txt` describes the complete API contract.

## Scope and limits

Uploads need a private test token. One token currently acts as one owner; it is not a production account system. A token can create, inspect, mark sent, and delete its own transfers. Account deletion is deliberately absent from the API.

Files are capped at 1 decimal GB, uploaded sequentially in 8 MiB chunks. The server buffers only one bounded chunk per request. The preview limits new sessions to 100/day per token; production requires atomic per-account quotas and stronger concurrency controls. Downloads stream from R2, support byte ranges, and always use attachment headers. No charges are applied. Quoted prices describe planned billing only.

A completed upload becomes available for seven days. Downloads check expiry and deletion before reading R2. A download already underway can finish after expiry or deletion. Inaccessible files are removed by a bounded cleanup pass during transfer creation or authenticated `POST /api/cleanup`. Background scheduling is not configured, so bytes can persist beyond expiry while the prototype is idle. Abandoned uploads expire after 24 hours. Metadata remains for status; deletion removes the file name and sender label. This is not an account-erasure implementation.

Status is polled. Download GETs (including range requests) are counted as requests, not confirmed completed downloads or unique recipients. HEAD requests do not count. “Sent” is a report from the delivering agent. No email service or outgoing webhook is required for this prototype.

A feature-detected WebMCP tool refreshes the currently displayed transfer. The HTTP API was tested end to end locally and with a live agent transfer. WebMCP registration was observed in the live browser, but valid tool execution was not verified because the browser upload test was not authorized. WebMCP is optional and is not required by the Python client.

## Next session

Connect the chosen domain and decide whether to retain managed Sites hosting or deploy this Worker in the owner's Cloudflare account. Add Google authentication, revocable scoped API tokens, Stripe Checkout top-ups, a dollar-denominated transactional ledger, and owner-only account deletion in the app. Decide unused-balance/refund handling before launch. Add scheduled expiry cleanup and incomplete multipart cleanup, atomic spending reservations and release, rate and storage limits, and confirmed-payment handling with idempotency. Bonus credit, outbound webhooks, automatic top-ups, and higher file limits are not yet committed features.
