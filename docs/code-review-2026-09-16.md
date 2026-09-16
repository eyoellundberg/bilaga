# Code review — 16 September 2026

## Fixed locally

- Upload quotes could round an exact cent boundary up by one cent because division introduced floating-point error before multiplication. Multiply the integer byte count first; regression coverage checks every charge boundary from 26 to 500 cents and its adjacent bytes.
- Concurrent uploads could both pass the free-allowance read before either reserved storage. The transactional reservation now rechecks free storage and monthly eligibility. A racing request is rejected and can retry for a fresh quote; paid balance reservations remain atomic.
- Stripe signature timestamp validation now rejects nonnumeric/nonfinite values before checking age. This is defense in depth: a valid HMAC is still required. Signature verification is isolated from Worker bindings for direct regression tests.
- Unknown nonempty Checkout offer versions fail explicitly instead of silently crediting dollar-for-dollar. Sessions without offer metadata retain legacy behavior. Both packs and duplicate delivery are covered locally.
- Account reads run concurrently; account-page limit types derive from the shared rules instead of duplicating the API shape. Worker dispatch parses its URL once.
- Updated an obsolete $10 test fixture that expected payments-unavailable even though that amount is no longer a valid pack.

## Follow-up fixes completed locally

- **Credit expiry:** migration 0009 creates per-purchase lots and spend allocations. Existing balances remain non-expiring. New purchases expire after three calendar years (February 29 anniversaries clamp to February 28), with separate paid and promotional lots. Transactional triggers enforce FIFO spending and restore refunds to original, unexpired sources. Expired refunds do not renew credit.
- **Display and reminders:** account and balance APIs return remaining lots and dates; the account page displays them. Scheduled expiry runs in bounded batches, while request-time checks prevent spending expired funds. Unused credit receives a reminder 30 days before expiry; lots sharing an account and expiry date share one email. Claims prevent overlapping routine sends, and failed sends retry. A crash after provider acceptance can still duplicate an email.
- **Operator grants:** the account increment and ledger insert now share one D1 batch, including lot creation.
- **Priced transfers:** a unique settlement ID guards follow-on debit, credit and ledger statements. Concurrent payment tests check that only one payment is recorded. Promotional sources remain traceable through allocations; there is still no cash payout feature.
- **Webhook queue:** each row is claimed immediately before delivery. The completion update checks the lease as well as attempt count, preventing a stale worker from overwriting a newer claim. The direct test endpoint also handles its null lease correctly.

## What remains

1. Deploy migration `0009_credit_lots.sql` and the new Worker together, then smoke-test the account page and scheduler. No remote migration or deployment has been performed here.
2. Verify both packs through real Stripe sandbox Checkout, then perform the live $15 purchase and confirm successful webhook delivery, exactly one ledger credit, the balance and expiry display. Local callback signatures do not verify real card processing or the live restricted key.
3. Complete the previously recorded production checks: Google sign-in, full 50 GB transfer/recovery, R2 orphan-multipart lifecycle, monitoring and abuse handling. They are operational checks, not covered by the local regression suites.

## Validation

- Lint, TypeScript and production build passed.
- Nine unit tests passed (five client, four billing).
- Deterministic SQLite migration/trigger tests passed: legacy balances, FIFO spending, paid/promotional separation, refunds before and after expiry, insufficient/expired-credit rollback, idempotent expiry, grant rollback and erased-account cleanup.
- Local account suite passed, 35 counted HTTP checks plus signed callbacks, lot display, grouped scheduled reminders and exactly-once expiry assertions.
- Local network suite passed, 82 counted checks plus concurrent free-storage reservations and concurrent settlement (one debit and payment record).
- Local transfer integration suite passed, 43 checks, with scheduled cleanup enabled.
- Local security suite passed: request boundaries, CSP, concurrency, immutable chunks, purge retries, quotas and rate limiting.
- Migration 0009 was applied locally. The final orphan-safe expiry trigger was refreshed locally after the full HTTP run; its erased-account regression passed against the final migration in SQLite.
- Tests used local D1/R2, simulated email and synthetic webhook signatures. No Stripe secret key was supplied to the emulator. Full-size transfer and production flows were not rerun.
