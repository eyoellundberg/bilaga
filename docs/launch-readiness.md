# Launch readiness — 13 September 2026

This file separates current implementation from verification and publication. The existing direct Cloudflare Worker at bilaga.link is the deployment target. The account/large-file/policy source was deployed on 13 September 2026. Deployment evidence is below; this is not public-launch certification.

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
- Before paid uploads: implement idempotent Stripe payment confirmation, durable dollar ledger with per-purchase 24-month expiry, atomic credit reservation/release, completed-transfer charging, refunds/withdrawal/unused-credit/account-deletion handling, tax disclosures, and support. New accounts remain upload-gated; never bypass this gate for unrestricted paid access.

## Sources for policy / provider review

Cloudflare [native email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) and [local simulated sending](https://developers.cloudflare.com/email-service/local-development/sending/). EDPB [controller and processor guidance](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en), and the EU Labour Authority [GDPR manual](https://www.ela.europa.eu/sites/default/files/2023-02/ELA_GDPR_Training_Manual_final_2023.pdf) describe information notices must address. These informed draft completeness; no legal compliance certification is asserted.

## Account simplicity and email placement — 13 September 2026

Removed the agent-name field; new tokens receive an automatic label, and agent access is in an expandable section beneath credit information. Credit balances and refill remain unimplemented; the page states that payments are unavailable. Owner confirmed real sign-in, but Gmail placed the message in junk. Wrangler confirms sending remains enabled; public DNS has one return-path SPF record, the configured DKIM selector and a DMARC reject policy. Owner-provided Gmail headers confirm SPF PASS, DKIM PASS for both bilaga.link and cloudflare-smtp.org, and aligned DMARC PASS. TLS 1.3 was used. Authentication failure is ruled out for that message; Gmail’s exact junk-classification cause is not exposed. Reputation/content filtering remains possible, not established. No speculative DNS changes were made.

Account simplification deployed as Worker version 2cf344be-7a68-49f2-9c65-ce2f3c28dfa0. Build, lint, and TypeScript passed.
