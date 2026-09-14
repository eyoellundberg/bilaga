export const MAX_BYTES = 50_000_000_000;
export const PART_BYTES = 8 * 1024 * 1024;
export const DAY = 24 * 60 * 60 * 1000;
export const RETENTION = 30 * DAY;
export const MAX_STORED_BYTES = 100_000_000_000;
export const MAX_PENDING_UPLOADS = 3;
export const MAX_DAILY_TRANSFERS = 100;
export type Tier = 'free' | 'full';
export type Limits = {
  tier: Tier;
  max_file_bytes: number;
  retention_ms: number;
  max_stored_bytes: number;
  max_daily_transfers: number;
  max_pending_uploads: number;
};
// Free accounts are self-serve and need no approval. Full accounts are enabled by hand.
export const TIERS: Record<Tier, Limits> = {
  free: {
    tier: 'free',
    max_file_bytes: 1_000_000_000,
    retention_ms: 7 * DAY,
    max_stored_bytes: 2_000_000_000,
    max_daily_transfers: 5,
    max_pending_uploads: 1,
  },
  full: {
    tier: 'full',
    max_file_bytes: MAX_BYTES,
    retention_ms: RETENTION,
    max_stored_bytes: MAX_STORED_BYTES,
    max_daily_transfers: MAX_DAILY_TRANSFERS,
    max_pending_uploads: MAX_PENDING_UPLOADS,
  },
};
export function describeLimits(l: Limits) {
  return {
    tier: l.tier,
    max_file_bytes: l.max_file_bytes,
    max_stored_bytes: l.max_stored_bytes,
    max_pending_uploads: l.max_pending_uploads,
    max_daily_transfers: l.max_daily_transfers,
    retention_days: Math.round(l.retention_ms / DAY),
  };
}
export function quoteCents(bytes: number) {
  return Math.max(25, Math.ceil((bytes / 1_000_000_000) * 10));
}
export function validSize(bytes: unknown): bytes is number {
  return (
    typeof bytes === 'number' &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    bytes <= MAX_BYTES
  );
}
export function fileLabel(bytes: number) {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : bytes >= 1e3
        ? `${(bytes / 1e3).toFixed(1)} KB`
        : `${bytes} bytes`;
}
export function cleanFilename(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A filename is required.');
  const name = value
    .normalize('NFC')
    // Strip control characters deliberately: filenames must be safe in headers and UI.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f/\\‪-‮⁦-⁩]/g, '_')
    .trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
    name.length > 180 ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      name,
    )
  )
    throw new Error('Use a filename of 1–180 characters.');
  return name;
}
export function contentDisposition(name: string) {
  return `attachment; filename="${name.replace(/[^a-zA-Z0-9._ -]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
