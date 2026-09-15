import { env } from 'cloudflare:workers';
import { fail } from './http';
import { topUpPack } from './rules';

// Stripe Checkout without the SDK: two REST calls and one HMAC. The secret key
// creates sessions; the webhook secret authenticates Stripe's callback.
const settings = () =>
  env as unknown as { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string };
export const stripeConfigured = () =>
  !!(settings().STRIPE_SECRET_KEY && settings().STRIPE_WEBHOOK_SECRET);

export async function createCheckout(accountId: string, amountCents: number, origin: string) {
  const pack = topUpPack(amountCents);
  if (!pack) return fail(400, 'invalid_amount', 'Choose $15 or $30.');
  const key = settings().STRIPE_SECRET_KEY;
  if (!key || !settings().STRIPE_WEBHOOK_SECRET)
    return fail(503, 'payments_unavailable', 'Card top-ups are not configured.');
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': `Bilaga — up to ${pack.up_to_gb} GB of transfers`,
    'line_items[0][quantity]': '1',
    'metadata[account_id]': accountId,
    'metadata[amount_cents]': String(amountCents),
    'metadata[offer]': 'packs_2026_09',
    'line_items[0][price_data][product_data][description]': 'One-time payment. Credits valid for 3 years. $0.25 credit minimum per paid transfer; 30-day download availability.',
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
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
// Stripe-Signature: t=<unix>,v1=<hmac-sha256(secret, `${t}.${body}`)>[,v1=...]
export async function verifyStripeSignature(header: string | null, body: string, toleranceMs = 5 * 60_000) {
  const secret = settings().STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.trim().split('=') as [string, string]),
  );
  const t = parts.t;
  const sigs = header.split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() - Number(t) * 1000) > toleranceMs) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}
function timingSafeEqual(a: string, b: string) {
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
