# Bilaga

Private preview of file transfers for agents, hosted on the existing Cloudflare Worker at https://bilaga.link (also workers.dev). D1 holds accounts and transfer metadata; a private R2 bucket holds file bytes. The older Sites deployment is separate and must not be used for publication.

## Current implementation — 12 September 2026

Email magic links are browser-bound, single-use, and expire after 15 minutes. Sessions use HttpOnly, SameSite cookies and last up to 30 days. Accounts manage up to ten individually revocable agent tokens; only token hashes are stored. All tokens for an account share transfers and quotas. New accounts have uploads disabled until explicitly admitted to the private preview. Account deletion requires a sign-in within 15 minutes and typed email confirmation. It immediately revokes sessions, tokens, pending login links, and download links, and redacts email, filenames, and sender labels. Scheduled cleanup removes files with retries. Redacted account/transfer tombstones remain at least one day and until storage purge succeeds.

Accepted files: 1–50,000,000,000 bytes, sequential 8 MiB multipart requests, 30-day access from completion. Existing transfers keep their original expiry. Limits: 100 creations/day, three unfinished uploads, 100 decimal GB reserved storage per owner, 300 API requests/minute per owner, 120 download requests/minute per link. Uploads expire after 24 hours when unfinished. Matching chunk retries are idempotent; changed bytes are rejected. Resume skips only parts with an ETag. Browser uploads retry chunks within the current page; durable resume across process/page restarts is provided by the Python client, not the browser UI.

Downloads stream with ranges and attachment headers. Anyone holding a valid link can download. Files are not malware-scanned or end-to-end encrypted. Download GET requests are counted, including ranges; counts do not prove completed downloads or unique people. The agent reports delivery; Bilaga sends login emails only, not recipient delivery messages.

Enabled preview uploads are free. Stripe, balances, credit reservations, and paid uploads are unimplemented. Planned offer: USD 15/30 top-ups, USD 0.10 per decimal GB, USD 0.25 minimum per completed transfer, credit expiring 24 months after each purchase. Live Stripe testing is deferred.

See [launch readiness](docs/launch-readiness.md) for verification and outstanding work, [security review](docs/security-review.md) for historical checks, and /privacy and /terms for draft preview policies. Operator/contact details and provider retention/transfer arrangements must be confirmed before publishing the policies or opening public enrollment.

## Local validation

Use Node 22.13+, Python 3.10+, and npm ci. Keep .env and .bilaga-token ignored and owner-readable. .env contains the intended BILAGA_TOKEN_HASH only. Never print or commit credentials.

Build with npm run build. Apply all local migrations with npx wrangler d1 migrations apply DB --local --config wrangler.cloudflare.json --persist-to .wrangler/state. Run the built Worker:

```sh
npx wrangler dev --config wrangler.cloudflare.json --ip 127.0.0.1 --local-upstream localhost:3119 --port 3119 --test-scheduled --persist-to .wrangler/state --env-file .env
```

Local email is simulated, so it proves binding invocation rather than inbox delivery. Cloudflare Email Service domain sending must be enabled for login@bilaga.link before real delivery. AUTH_ORIGIN is https://bilaga.link; localhost:3119 is allowed for local tests.

```sh
npm run test:client
npm run lint
npx tsc --noEmit
BILAGA_TEST_CONFIG=wrangler.cloudflare.json BILAGA_TEST_SCHEDULED=1 python3 tests/integration.py
python3 tests/accounts.py
python3 tests/scheduled.py
BILAGA_TEST_CONFIG=wrangler.cloudflare.json python3 tests/security.py
python3 tests/interrupted-upload.py
python3 tests/large-transfer.py
BILAGA_TEST_BYTES=50000000000 python3 tests/large-transfer.py
```

Run HTTP suites sequentially against synthetic LOCAL data. They manipulate fixture expiry/quotas and permanently remove test files. The full transfer uses approximately 50 GB of R2 emulator storage plus a sparse source and bounded buffers; ensure enough disk space. The full test honors request limits, so it can take over 20 minutes. Never point these suites at production. Agent client: public/bilaga.py. API contract: public/llms.txt and /docs.

## Cleanup and publication

The 15-minute scheduled job purges up to 25 eligible transfers/run and aborts unfinished uploads. Failures/backlogs delay physical deletion. A lost storage-allocation response can leave an untracked multipart upload; confirm an R2 abort lifecycle rule as an additional safeguard. Normal transfer metadata remains for status after file purge; account deletion removes redacted tombstones after the grace period. A download already started may finish after revocation or expiry, and recipient copies cannot be recalled.

For the existing direct Cloudflare deployment, apply migration 0002 before deploying account code. Build, apply remote migrations with the explicit wrangler.cloudflare.json configuration, and deploy with the intended .env secrets file. Do not use generated Sites hosting configuration. Record the Worker version, migrations, email configuration, and production smoke checks in launch-readiness.md. Local changes are not evidence of deployment.

npm run lint covers all application code; unused starter components and the OpenAI Sites plugin were removed. lib/client-api.ts owns browser retries/chunks, lib/http.ts bounded body handling, lib/rules.ts shared limits, and lib/accounts.ts account routes.
