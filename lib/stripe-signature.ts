const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
// Stripe-Signature: t=<unix>,v1=<hmac-sha256(secret, `${t}.${body}`)>[,v1=...]
export async function verifySignature(secret: string | undefined, header: string | null, body: string, toleranceMs = 5 * 60_000) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.trim().split('=') as [string, string]),
  );
  const t = parts.t;
  const sigs = header.split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !/^\d+$/.test(t) || !Number.isSafeInteger(Number(t)) || !sigs.length || Math.abs(Date.now() - Number(t) * 1000) > toleranceMs) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}
function timingSafeEqual(a: string, b: string) {
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
