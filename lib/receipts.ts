import { env } from 'cloudflare:workers';
import { sha256 } from './hash';

// Receipts are signed with an Ed25519 key held only by the Worker. Anyone can
// verify one offline with the published public key; nothing here trusts the UI.
export const RECEIPT_VERSION = 1;
export const CONTENT_HASH_ALGORITHM = 'bilaga-chunked-sha256-8mib';
export const SIGNATURE_ALGORITHM = 'ed25519';
export const CANONICALIZATION = 'json-sorted-keys-no-whitespace-utf8';

type Jwk = JsonWebKey & { x: string; d?: string };
const settings = () => env as unknown as { RECEIPT_SIGNING_KEY?: string };
let cached: Promise<{ key: CryptoKey; publicKey: string; keyId: string } | null> | undefined;

function base64urlToHex(value: string) {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
}
export const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

async function load() {
  const raw = settings().RECEIPT_SIGNING_KEY;
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
export async function signReceipt(receipt: Record<string, unknown>) {
  const s = await signer();
  if (!s) return null;
  const message = new TextEncoder().encode(canonical(receipt));
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, s.key, message);
  return {
    receipt,
    signature_hex: toHex(signature),
    key_id: s.keyId,
    public_key_hex: s.publicKey,
    algorithm: SIGNATURE_ALGORITHM,
    canonicalization: CANONICALIZATION,
    verify_url: '/api/receipt-key',
  };
}
// Whole-file identity from the per-chunk digests already verified during upload.
export async function contentHash(partHashesHex: string[]) {
  const bytes = new Uint8Array(partHashesHex.length * 32);
  partHashesHex.forEach((h, i) => bytes.set(hexToBytes(h), i * 32));
  return sha256(bytes);
}
