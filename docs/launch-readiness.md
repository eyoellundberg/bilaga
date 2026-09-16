# Abuse policy — 16 September 2026

/terms gains an "Abuse and takedowns" section: files are unscanned, reports go by email to the operator contact with the link, the operator removes offending files, closes the sending account and replies to the reporter; the receipt stays, redacted. This closes the open policy item in "Missing before public enrollment". The 50 GB reliability run and the Google sign-in click-through were deliberately skipped for launch day at the co-founder's call; both remain listed as unverified in production. The revised Plus/Pro offer was already live before this change (/api/config reports both packs and 5 free transfers). The live $15 purchase is still the operator's to make.

# Multi-file requests — deployed 16 September 2026

Deployed as Worker version c8547872 (commit 4b42e7a) after migration `0010_file_requests.sql` was applied to production D1 with `d1 migrations apply --remote` (no trigger bodies, so the standard path worked; a first attempt hit a transient API 7403 and the retry succeeded). Verified live: `d1_migrations` ends at 0010, `file_requests` table and `transfers.request_id` present, `/`, `/docs`, `/llms.txt`, `/r/{id}` return 200, `/api/requests` returns 401 without a token, `/api/drop/{id}` returns 404 without a key. Before deploying, all local suites passed on a freshly restarted worker: requests 78, transfers 43, accounts 35, network 82, security, billing 4, client 5, lint and typecheck clean. Python client request support (requester: --request/--requests/--request-status/--request-revoke/--request-receipt; uploader with only the link: --drop-file/--drop-status/--drop-remove/--done) deployed as Worker version 23fcc4e8 after the request suite passed with a client round-trip (95 checks) and the transfer suite passed (43). Live /bilaga.py and /llms.txt serve the new commands; the live client was run against bilaga.link and returned the expected 404 for an unknown link. No live end-to-end request submission has been made yet.

General file requests are implemented. An account holder creates a scoped link, guests upload multiple files without signup, and Done freezes a signed submission manifest and queues one `request.submitted` event. Bilaga supplies files, hashes, submission time and an unverified uploader email; the requesting application owns acceptance criteria, payments and deadlines. Existing per-file billing is charged to the requester; Done adds no charge.

Migration `0010_file_requests.sql` is applied locally and must be applied to the deployment database before publishing this Worker. API contract is in `public/llms.txt`. Guest upload links keep their secret in the URL fragment and authenticate API calls via a header. Request receipts and uploader emails require owner authentication. Revocation, account deletion, file/byte caps and concurrent Done/upload checks are implemented. Browser verification completed a two-file guest submission. The previous account/network/transfer/security suites passed; final request-specific verification is recorded below after completion.

# Current update — 16 September 2026 (local changes, not deployed)

Credit-expiry and review fixes are implemented locally. See [the current review](code-review-2026-09-16.md) for the exact scope and remaining production checks. Migration 0009 preserves existing balances, introduces purchase lots and FIFO allocations, and supplies transactional expiry/refund triggers. New Worker code displays expiry dates and schedules reminders. Grant writes are atomic, settlement guards use unique IDs, and webhook claims occur immediately before delivery.

**Next release:** apply migration 0009 and deploy the Worker together; verify the account page, scheduled job, both Stripe packs in sandbox and one live purchase. Old deployment notes below are historical evidence and contain superseded requirements. No production changes were made during this code review.

# Legal pages rewritten (16 September 2026)

- /terms and /privacy rewritten plainly for the current product (Plus/Pro packs, free allowance, Google sign-in, Stripe, 30-day files, no scanning). /policy aliases /privacy. Operator name and country come from lib/legal.ts; contact set to the operator's email, so the DRAFT label is gone. Pricing numbers render from lib/rules.ts. Deployed.


- Worker version ba23a96c deployed with GOOGLE_CLIENT_ID (a dedicated Bilaga Google Cloud project; the first client belonged to another project's consent screen) as a var and GOOGLE_CLIENT_SECRET as a secret. The consent screen now reads bilaga.link. /api/auth/methods reports google:true; /api/auth/google redirects to Google with PKCE and the bilaga.link callback; Google accepts the client and redirect URI (no redirect_uri_mismatch). Completing a sign-in requires the operator's Google credentials and was not performed by the agent.
- This deploy also publishes the revised offer below (Plus/Pro packs, 5-transfer allowance).


- Website, account checkout, API docs, README and bilaga.md now describe $15 → $15 credit / up to 150 GB and $30 → $40 credit / up to 400 GB. Larger pack costs 25% less per GB.
- Packs are named Plus ($15) and Pro ($30) in checkout product names, the account page, docs, README, llms.txt and bilaga.md. Home pricing is three cards (Free / Plus / Pro) with one line of terms; rounding and coverage caveats live in the docs and terms. Visually checked at 800px on the local dev server; lint, tsc, build and the five client tests pass.
- Free allowance reduced from 20 to 5 transfers per rolling 30 days (FREE_MONTHLY_TRANSFERS in lib/rules.ts); 5 GB stored unchanged. Copy updated on home, docs, README, llms.txt and bilaga.md. Applies to existing accounts at their next transfer.
- No subscription; three-year purchased-credit validity policy. Same 30-day file availability and free allowance. Existing $0.25 minimum and cent rounding remain and are disclosed.
- Checkout offer metadata and webhook credit amounts updated; legacy checkout sessions retain their original credit amount.
- Before activating live payments: implement per-purchase expiry tracking and enforcement, oldest-first spending, expiry display and reminders; retain existing credit terms for previous purchases. Aggregate balance currently does not enforce expiry.
- Local validation passed: lint, TypeScript, production build, five client tests, and pack arithmetic checks (credit amounts, 150/400 GB capacity at 50 GB per transfer, minimum charge, and 25% discount).
- Repeat sandbox checkout and signed-webhook replay verification for both packs, then deploy. No deployment or live Stripe changes performed as part of this copy update.
- Promotional credit must be separated from withdrawable proceeds before experimental priced transfers support payouts.

# Launch readiness — 15 September 2026

This file separates current implementation from verification and publication. The existing direct Cloudflare Worker at bilaga.link is the deployment target. The account/large-file/policy source was deployed on 13 September 2026. Deployment evidence is below; this is not public-launch certification.

## Free allowance, charges, Stripe Checkout — 15 September 2026 (night)

- Migration 0008 (charged_cents) applied locally and remotely. Worker version 4bf7f31a-a64d-4e75-aeaa-222764e21ee1 deployed after all suites passed: transfer 43, accounts 33 (top-up amount validation, 503 without a Stripe key, webhook credits once per session id, replay credits nothing, wrong secret and stale timestamp rejected, unpaid session ignored), scheduled, security, network 73 (402 with price outside the free storage, charge debited at creation, refund on deletion before completion, minimum charge past the monthly count, completed charge kept, owner token never charged).
- Production: config reports free allowance then balance, 5 GB and 20 per 30 days, top-ups unavailable until Stripe secrets exist; quote for 1 GB is $0.25; home and docs carry the new pricing; the webhook rejects unsigned posts; an owner-token upload is still free.
- Stripe connected in test mode (Bilaga Sandbox): webhook endpoint we_1UFthbEN2Pnuwhl0WIJhLcMB created through the CLI with its secret piped into the Worker unseen; the operator uploaded the sandbox secret key. Verified end to end: the server created a real Checkout session for a throwaway account; `stripe trigger checkout.session.completed` with that account in metadata credited $30 (fixture amount) once; the operator's own $10 Checkout with the test card credited exactly $10. Throwaway account deleted afterwards. Remaining for live money: switch the CLI and both secrets to the live account, register the live webhook, and repeat one real top-up.

## Receipts kept forever — 15 September 2026 (evening)

- Migration 0007 (receipt_requests, content-hash index) applied locally and remotely. Worker version 024a3bfa-883d-400f-b999-92625b53d2c2 deployed after all suites passed: transfer suite 43 (receipt after deletion with status deleted and redacted filename, lookup by hash, counter, client `--receipt-hash` verification), accounts 30 (redacted transfer row and email-less account tombstone survive scheduled erasure; the deleted receipt still resolves the sender handle), scheduled, security, network 59.
- Production: home page leads with free sending and permanent receipts, no selling copy. The morning's addressed test transfer resolves by id with status available and by content hash, the counter increments, and the shipped client verifies the hash lookup against the original file.
- Pricing decision: Stripe Connect payouts are not being built; priced transfers stay in the API marked experimental. The only Stripe work still planned is plain Checkout for the sender's own storage top-ups.

## Open to everyone, Google sign-in, priced transfers, verification spec — 15 September 2026 (afternoon)

- Migration 0006 (balances, last login method, prices, ledger) applied locally and remotely. Worker version b1d28d7d-ca41-48bc-9d20-fa7576cf7ef4 deployed to https://bilaga.link after all suites passed on the deployed build: client tests 5, transfer suite 39, accounts 30 (now includes the Google start redirect, browser-bound state, mismatched-callback rejection, and the last-used cookie), scheduled, security, network 59 (adds priced transfers: addressing required, owner token refused, 402 before payment, insufficient balance, idempotent repeat payment, other-account conflict, settlement arithmetic with the 5% fee, ledger rows, receipt settlement fields, transfer.paid events).
- Production smoke test: /api/config reports mode open, 50 GB, 20/day, 30 days, fee 500 bps, operator-grant top-ups. Pages /, /docs, /account, /verify, /llms.txt, /bilaga.py, /privacy, /terms return 200; /preview is gone (404); POST /api/waitlist is gone (401 from the token gate). /api/auth/methods reports email only; /api/auth/google returns 503 until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. /api/receipt-key advertises spec_url and empty retired_key_ids. Priced creation and balance with the owner token are refused with 403 account_required as designed.
- Not yet exercised in production: a real Google sign-in (needs the OAuth client), and a real paid transfer between two accounts (needs an operator credit grant via POST /api/credits). Both passed locally.
- Test hygiene lessons: the account and network suites create new accounts every run, so the daily signup throttle and the owner token's daily transfer limit fill up after a few runs; both suites now reset their own local limiter and purged-transfer rows at start.

## Recipient identity and webhooks — 15 September 2026

- Migration 0005 (handles, addressing, webhooks, events) applied locally; all suites re-run against the rebuilt Worker: client tests 5, transfer suite 39, accounts 25, scheduled, security, and the new network suite with 44 checks (webhook URL validation, signed test delivery verified with the shipped client, tampered event rejected, addressed transfer hidden from the public page, inbox isolation, received-by recorded from an authenticated download, reply chaining with `transfer.reply` to the original sender, event feed ordering/paging/filtering, failed delivery retried and drained by the scheduled job, account deletion redaction).
- Lesson recorded: `wrangler dev` did not reload later builds during this session; restart it after every build before trusting a test result.
- Remote migration 0005 applied (13 commands). Worker version 97f619bf-3553-4b8c-93ae-60d58ec74f6b deployed to https://bilaga.link after the full local suite passed on the deployed build.
- Production smoke test: /api/config reports `signals: polling_events_webhooks`, `addressing: email`, signed receipts. All eight pages return 200. Webhook, inbox, and events endpoints refuse the owner test token with 403 account_required as designed. A small text file addressed to the operator's email uploaded and completed through the shipped client; the public download page does not contain the email; the receipt verifies offline and shows `addressed: true` with no recipient account yet. That transfer (public id 2dc80abd…) was left in place so the operator can see it in their inbox after signing in.
- Not yet exercised in production: a real account registering a webhook against a public https endpoint, and the recipient side (inbox listing, authenticated download, reply). Both passed locally against the same build.

## Direct Cloudflare deployment — 13 September 2026

- Wrangler OAuth renewed with email_sending:write. CLI confirmed bilaga.link Email Sending was already enabled since 12 September 2026. Public DNS resolves the configured return-path MX, SPF, DKIM and DMARC records; no domain/DNS changes were needed.
- BILAGA_TOKEN_HASH uploaded from the ignored local .env without printing its value; secret list confirmed secret_text.
- Remote migration 0002_lowly_bulldozer.sql applied successfully (12 commands).
- Build, lint, TypeScript and all five client tests passed.
- Worker version 24020af6-3767-4e95-923c-57e3b7f2f7d6 deployed at https://bilaga.link and the existing workers.dev address, with EMAIL, DB, FILES, ASSETS, canonical AUTH_ORIGIN and the 15-minute cleanup schedule.
- Live /account rendered the email sign-in form. A CLI POST to /api/auth/request for the owner inbox returned HTTP 200 after the Email Service send call completed. Owner confirmed inbox receipt and successful browser sign-in on 13 September; the message landed in junk, so inbox placement remains unresolved. The CLI request is sending-path evidence only; request a fresh link from the browser for the end-to-end sign-in test.
- No openai-sites or sites executable was found on PATH. Native Sites listing confirmed the old Bilaga project remains active and public at https://bilaga.eyoel-lundberg.chatgpt.site. The available connector has no project deletion operation. Dashboard deletion remains outstanding.

## Historical local verification — 12 September 2026

| Check | Result |
|---|---|
| Transfer HTTP suite | Passed, 37 checks: real local Worker/D1/R2, multipart bytes and retries, authentication, completion idempotency, ranges, download counts, deletion, 30-day expiry and cleanup |
| Account HTTP suite | Passed, 25 checks plus assertions: simulated email, browser binding, expired/reused links, isolated accounts, hash-only tokens, individual revocation, upload gate, recent-login deletion, pending login link revocation, immediate session/token/file-link revocation, scheduled file purge and eventual metadata erasure, logout |
| Scheduled cleanup | Passed: abandoned multipart abort, recorded purge, part removal, active-file preservation, repeat execution |
| Security suite | Passed: request boundaries, nonce CSP, unsupported action rejection, concurrent quotas, immutable parts, attachment serving, completion/deletion race, purge retries, storage quota, rate-limit Retry-After |
| Client tests | Passed, 5: redirects/auth retries, transient failure, Retry-After/cancel, byte boundaries, SHA-256 known answer |
| Build/lint/TypeScript | Passed for tested source; repeat after final edits |
| 50 GB boundary | Passed: maximum declaration, shorter final part, out-of-range part, refusal of incomplete completion, cleanup |
| Actual client interruption | Passed: terminated the shipped client after two confirmed chunks, restarted with the same ID, retained ETags, completed 100,663,419 bytes, verified the full download hash, removed disposable data |
| Full 50 GB and resume | Running; do not mark as passed until complete streamed download hash and cleanup finish |
| Real inbox delivery/sign-in | Pending; local Cloudflare email is simulated. User chose to defer providing an inbox |
| Browser account page | Simulated email request, confirmation, signed-in gated account and logout verified. Existing-tab fragment navigation fix undergoing final check |
| Privacy/terms pages | Drafts implemented with requested Lorem ipsum operator/contact/address placeholders; final details unresolved |
| Live Stripe | Deferred by user; no billing implementation or live payment tests |

## Fixes and documentation

The stale preview and invalid Host override contributed to local request errors. Use --ip 127.0.0.1 --local-upstream localhost:3119 --port 3119 without --host localhost:3119. worker.ts dispatches explicit APIs without framework body clones, retains API security headers, and discards rejected bodies with bounded streaming and a deadline. Bounded body reads do not cancel the incoming transport before returning an error. Unsupported Server Actions and non-API mutations remain rejected. API memory remains bounded by chunks, not whole file size.

The account page handles login fragments at mount and during existing-tab navigation; it removes the token fragment from the URL and requires explicit confirmation. README, project decision summary, agent API contract, and human guide now describe owner-shared quotas, chunking, Python resume, 30-day retention, deletion timing, and current billing status. The old security review is retained as historical evidence.

## Missing before public enrollment / paid launch

- Confirm legal operator, contact address, business address, abuse reporting channel, and response process; replace Lorem ipsum and finalize privacy/terms. Confirm processing purposes/bases and rights requests, customer-file controller/processor roles and any DPA, Cloudflare processing agreements/locations/transfer safeguards, provider email/log/backup retention. Do not claim EU-only storage or immediate physical erasure.
- Email Sending is enabled and the live login send request succeeded. Verify actual inbox delivery, same-browser confirmation, expired/reused links, and failure handling. Native sending uses the current Email Service API, not the older Email Routing-only model.
- Migration 0002 and account code deployment are complete (see above). Complete production smoke tests for account isolation, token revocation, deletion, scheduled cleanup, and current API limits.
- Complete full-size local testing, then separately validate real Cloudflare/R2 reliability, representative connections, interruption/network failure and lost response recovery, throughput and Worker resource limits. Local emulator success is not production load certification.
- Confirm an R2 lifecycle rule that aborts orphan multipart allocations; test cleanup failures/backlogs and operational alerting. Scheduled cleanup is bounded and cannot promise immediate physical deletion. Confirm storage budgets, edge/global abuse limits, monitoring and incident response.
- Decide the public content/scanning/quarantine policy; current preview files are opaque and unscanned. Define a process for takedowns and malicious files.
- Before paid uploads: implement idempotent Stripe payment confirmation, durable dollar ledger with per-purchase three-year expiry, atomic credit reservation/release, completed-transfer charging, refunds/withdrawal/unused-credit/account-deletion handling, tax disclosures, and support. Free-tier limits and signup throttles replace the manual upload gate; paid access must still check balance before raising limits.

## Sources for policy / provider review

Cloudflare [native email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) and [local simulated sending](https://developers.cloudflare.com/email-service/local-development/sending/). EDPB [controller and processor guidance](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en), and the EU Labour Authority [GDPR manual](https://www.ela.europa.eu/sites/default/files/2023-02/ELA_GDPR_Training_Manual_final_2023.pdf) describe information notices must address. These informed draft completeness; no legal compliance certification is asserted.

## Account simplicity and email placement — 13 September 2026

Removed the agent-name field; new tokens receive an automatic label, and agent access is in an expandable section beneath credit information. Credit balances and refill remain unimplemented; the page states that payments are unavailable. Owner confirmed real sign-in, but Gmail placed the message in junk. Wrangler confirms sending remains enabled; public DNS has one return-path SPF record, the configured DKIM selector and a DMARC reject policy. Owner-provided Gmail headers confirm SPF PASS, DKIM PASS for both bilaga.link and cloudflare-smtp.org, and aligned DMARC PASS. TLS 1.3 was used. Authentication failure is ruled out for that message; Gmail’s exact junk-classification cause is not exposed. Reputation/content filtering remains possible, not established. No speculative DNS changes were made.

Account simplification deployed as Worker version 2cf344be-7a68-49f2-9c65-ce2f3c28dfa0. Build, lint, and TypeScript passed.

## Free tier, signed receipts, recipient loop — deployed 15 September 2026

New accounts are self-serve on a free tier (1 GB, 5/day, 1 pending, 2 GB stored, 7-day access); uploads_enabled=1 keeps full limits. Signup is throttled per IP (5/day) and per email domain (50/day). Completion stores a chunked content hash; GET /api/receipts/{public_id} returns an Ed25519-signed receipt and GET /api/receipt-key the public key. The Python client verifies receipts and files offline (pure-Python Ed25519, cross-checked against Node's signer). The download page links the receipt and invites recipients to send a file back.

Verified locally before deployment: build, lint, TypeScript, 5 client tests, and the integration (39 checks), account (25 checks), security, and scheduled suites against the local Worker with a local signing key. RECEIPT_SIGNING_KEY uploaded as a Worker secret without printing it; remote migration 0004 applied; Worker version 24ee9359-5422-4794-a886-837a3150a433 deployed to bilaga.link and workers.dev with the 15-minute schedule.

Production smoke test: /api/config reports signed_ed25519 receipts and both tiers; /api/receipt-key serves the key; /, /account, /docs, /preview, /llms.txt and /bilaga.py return 200. A 300,000-byte owner-token upload completed with a content hash, its download was verified against the signed receipt by the shipped client (all five checks true, download_requests 1), the transfer was deleted, and the receipt then returned 404. Not yet tested in production: a brand-new free-tier account end to end, and the signup throttles.

## Waitlist starter — 13 September 2026

Homepage replaced with an email waitlist; original app homepage preserved at /preview. Migration 0003 adds the deduplicated waitlist table. Local browser signup and storage verified; invalid email, cross-origin, duplicate, honeypot and rate-limit checks passed. Desktop/mobile layout, lint, TypeScript and build passed. Remote migration applied; Worker 77f8ef8a-48cf-4ad3-9a92-a1ba8e628ec4 deployed and live homepage verified. No launch emails sent.
