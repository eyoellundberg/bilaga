export const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (byteLength: number) => hex(crypto.getRandomValues(new Uint8Array(byteLength)));
export async function sha256(value: Uint8Array<ArrayBuffer>) {
  return hex(await crypto.subtle.digest('SHA-256', value));
}
