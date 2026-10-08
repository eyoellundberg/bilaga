export const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (byteLength: number) => hex(crypto.getRandomValues(new Uint8Array(byteLength)));
// Ids are 32 hex characters (randomHex(16)); tokens and digests are 64.
export const HEX32 = /^[a-f0-9]{32}$/;
export const HEX64 = /^[a-f0-9]{64}$/;
export async function sha256(value: Uint8Array<ArrayBuffer> | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}
