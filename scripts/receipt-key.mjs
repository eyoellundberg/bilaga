// Generate an Ed25519 receipt-signing key as a JWK for the RECEIPT_SIGNING_KEY secret.
// Usage: node scripts/receipt-key.mjs | npx wrangler secret put RECEIPT_SIGNING_KEY --config wrangler.cloudflare.json
// The private key is printed once to stdout only; never commit it.
const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', key.privateKey);
process.stdout.write(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d }));
