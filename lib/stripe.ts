import { verifySignature } from './stripe-signature';
import { env } from 'cloudflare:workers';
import { fail } from './http';
import { CREDIT_VALIDITY_YEARS, CURRENT_OFFER, choosePackMessage, topUpPack, usd } from './rules';

// Stripe Checkout without the SDK: two REST calls and one HMAC. The secret key
// creates sessions; the webhook secret authenticates Stripe's callback.
const settings = () =>
  env as unknown as { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string };
export const stripeConfigured = () =>
  !!(settings().STRIPE_SECRET_KEY && settings().STRIPE_WEBHOOK_SECRET);

export async function createCheckout(accountId: string, amountCents: number, origin: string) {
  const pack = topUpPack(amountCents);
  if (!pack) return fail(400, 'invalid_amount', choosePackMessage());
  const key = settings().STRIPE_SECRET_KEY;
  if (!key || !settings().STRIPE_WEBHOOK_SECRET)
    return fail(503, 'payments_unavailable', 'Card top-ups are not configured.');
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': `Bilaga ${pack.name}`,
    'line_items[0][quantity]': '1',
    'metadata[account_id]': accountId,
    'metadata[amount_cents]': String(amountCents),
    'metadata[offer]': CURRENT_OFFER,
    'line_items[0][price_data][product_data][description]': `${usd(pack.credit_cents)} of transfer credit, up to ${pack.up_to_gb} GB. One-time payment, valid for ${CREDIT_VALIDITY_YEARS} years.`,
    success_url: `${origin}/account#topup=ok`,
    cancel_url: `${origin}/account#topup=cancelled`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    console.error('Stripe checkout failed', res.status);
    return fail(502, 'payments_error', 'Stripe could not start the checkout. Try again.');
  }
  return { id: data.id!, url: data.url };
}
export function verifyStripeSignature(header: string | null, body: string) {
  return verifySignature(settings().STRIPE_WEBHOOK_SECRET, header, body);
}
