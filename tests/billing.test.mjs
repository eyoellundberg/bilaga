import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { quoteCents, topUpPack, MAX_BYTES, creditExpiry } from '../lib/rules.ts';
import { verifySignature } from '../lib/stripe-signature.ts';

test('upload charges round at exact cent boundaries without floating-point overcharges', () => {
  assert.equal(quoteCents(1), 25);
  for (let cents = 26; cents <= 500; cents++) {
    const bytes = cents * 100_000_000;
    assert.equal(quoteCents(bytes), cents);
    assert.equal(quoteCents(bytes - 1), cents);
    if (bytes < MAX_BYTES) assert.equal(quoteCents(bytes + 1), cents + 1);
  }
});

test('server-owned packs credit Plus and Pro correctly', () => {
  assert.equal(topUpPack(1500)?.credit_cents, 1500);
  assert.equal(topUpPack(3000)?.credit_cents, 4000);
  assert.equal(topUpPack(1000), undefined);
});

test('Stripe signatures require a valid fresh timestamp and authentic body, with rotation support', async () => {
  const secret = 'whsec_unit_test';
  const body = '{"test":true}';
  const now = Math.floor(Date.now() / 1000);
  const header = (timestamp) => `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  assert.equal(await verifySignature(secret, header(now), body), true);
  assert.equal(await verifySignature(secret, `v1=old,${header(now)}`, body), true);
  assert.equal(await verifySignature(secret, header(now), body + ' '), false);
  assert.equal(await verifySignature('wrong', header(now), body), false);
  for (const timestamp of ['NaN', 'Infinity', 'abc', now - 301, now + 301]) {
    assert.equal(await verifySignature(secret, header(timestamp), body), false);
  }
  assert.equal(await verifySignature(secret, null, body), false);
});

test('credit expiry preserves UTC time and clamps leap-day anniversaries', () => {
  assert.equal(new Date(creditExpiry(Date.parse('2024-02-29T12:34:56Z'))).toISOString(), '2027-02-28T12:34:56.000Z');
  assert.equal(new Date(creditExpiry(Date.parse('2026-09-16T12:34:56Z'))).toISOString(), '2029-09-16T12:34:56.000Z');
});
