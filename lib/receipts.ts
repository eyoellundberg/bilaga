import { env } from 'cloudflare:workers';
import { hex, sha256 } from './hash';

// Receipts are signed with an Ed25519 key held only by the Worker. Anyone can
// verify one offline with the published public key; nothing here trusts the UI.
export const RECEIPT_VERSION = 1;
export const CONTENT_HASH_ALGORITHM = 'bilaga-chunked-sha256-8mib';
export const SIGNATURE_ALGORITHM = 'ed25519';
export const CANONICALIZATION = 'json-sorted-keys-no-whitespace-utf8';

type Jwk = JsonWebKey & { x: string; d?: string };
let cached: Promise<{ key: CryptoKey; publicKey: string; keyId: string } | null> | undefined;

function base64urlToHex(value: string) {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return hex(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
}

async function load() {
  const raw = env.RECEIPT_SIGNING_KEY;
  if (!raw) return null;
  let jwk: Jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    return null;
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d || !jwk.x) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  const publicKey = base64urlToHex(jwk.x);
  const keyId = (await sha256(hexToBytes(publicKey))).slice(0, 16);
  return { key, publicKey, keyId };
}
export function signer() {
  cached ??= load().catch(() => null);
  return cached;
}
export async function publicKeyInfo() {
  const s = await signer();
  return s
    ? { key_id: s.keyId, public_key_hex: s.publicKey, algorithm: SIGNATURE_ALGORITHM }
    : null;
}
// Deterministic serialization: sorted keys, no whitespace, integers only, UTF-8.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
// Receipts and webhook events share one key and one envelope shape, so a client
// that verifies a receipt can verify an event with the same code.
export async function signPayload<K extends string>(kind: K, payload: Record<string, unknown>) {
  const s = await signer();
  if (!s) return null;
  const message = new TextEncoder().encode(canonical(payload));
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, s.key, message);
  return {
    [kind]: payload,
    signature_hex: hex(signature),
    key_id: s.keyId,
    public_key_hex: s.publicKey,
    algorithm: SIGNATURE_ALGORITHM,
    canonicalization: CANONICALIZATION,
    verify_url: '/api/receipt-key',
  } as { [P in K]: Record<string, unknown> } & {
    signature_hex: string;
    key_id: string;
    public_key_hex: string;
    algorithm: string;
    canonicalization: string;
    verify_url: string;
  };
}
export const signReceipt = (receipt: Record<string, unknown>) => signPayload('receipt', receipt);
// Whole-file identity from the per-chunk digests already verified during upload.
export async function contentHash(partHashesHex: string[]) {
  const bytes = new Uint8Array(partHashesHex.length * 32);
  partHashesHex.forEach((h, i) => bytes.set(hexToBytes(h), i * 32));
  return sha256(bytes);
}
