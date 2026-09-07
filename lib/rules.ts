export const MAX_BYTES = 1_000_000_000;
export const PART_BYTES = 8 * 1024 * 1024;
export const WEEK = 7 * 24 * 60 * 60 * 1000;
export const DAY = 24 * 60 * 60 * 1000;
export function quoteCents(bytes: number) { return Math.max(25, Math.ceil(bytes / 1_000_000_000 * 10)); }
export function validSize(bytes: unknown): bytes is number { return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAX_BYTES; }
export function fileLabel(bytes: number) { return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${(bytes / 1e3).toFixed(1)} KB` : `${bytes} bytes`; }
export function cleanFilename(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A filename is required.');
  const name = value.normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g,'_').trim();
  if (!name || name.length > 180 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name)) throw new Error('Use a filename of 1–180 characters.');
  return name;
}
export function contentDisposition(name: string) { return `attachment; filename="${name.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`; }
