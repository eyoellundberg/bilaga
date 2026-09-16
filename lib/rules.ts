export const MAX_BYTES = 50_000_000_000;
export const PART_BYTES = 8 * 1024 * 1024;
export const DAY = 24 * 60 * 60 * 1000;
export const RETENTION = 30 * DAY;
export const MAX_STORED_BYTES = 100_000_000_000;
export const MAX_PENDING_UPLOADS = 3;
export const MONTH = 30 * DAY;
// Free allowance: a small amount of storage and a handful of transfers per
// 30 days. Beyond it, each transfer is charged from the account balance at
// the storage price. The owner test token is never charged.
export const FREE_STORED_BYTES = 5_000_000_000;
export const FREE_MONTHLY_TRANSFERS = 5;
export const PRICE_CENTS_PER_GB = 10;
export const MINIMUM_CHARGE_CENTS = 25;
// Card top-ups are one-time packs. CURRENT_OFFER is stamped on each Checkout
// session so the webhook knows which pack table priced it; repricing means a
// new offer id and a new table, and old sessions keep their original credit.
export const CURRENT_OFFER = 'packs_2026_09';
export const CREDIT_VALIDITY_YEARS = 3;
export const TOP_UP_PACKS = [
  { name: 'Plus', amount_cents: 1500, credit_cents: 1500, up_to_gb: 150 },
  { name: 'Pro', amount_cents: 3000, credit_cents: 4000, up_to_gb: 400 },
] as const;
export type TopUpPack = (typeof TOP_UP_PACKS)[number];
export const topUpPack = (amount: number) => TOP_UP_PACKS.find((pack) => pack.amount_cents === amount);
// Whole dollars without decimals ($15), cents otherwise ($0.25).
export const usd = (cents: number) => `$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`;
export const packLabel = (p: TopUpPack) => `${p.name} · ${usd(p.amount_cents)}`;
export const choosePackMessage = () => `Choose ${TOP_UP_PACKS.map((p) => `${p.name} (${usd(p.amount_cents)})`).join(' or ')}.`;
export const describePacks = () =>
  TOP_UP_PACKS.map((p) => `${p.name} is ${usd(p.amount_cents)} for ${usd(p.credit_cents)} of credit (up to ${p.up_to_gb} GB)`).join('; ') +
  `. Paid once, valid for ${CREDIT_VALIDITY_YEARS} years.`;
export const LIMITS = {
  max_file_bytes: MAX_BYTES,
  retention_ms: RETENTION,
  max_stored_bytes: MAX_STORED_BYTES,
  max_pending_uploads: MAX_PENDING_UPLOADS,
  free_stored_bytes: FREE_STORED_BYTES,
  free_transfers_per_30_days: FREE_MONTHLY_TRANSFERS,
};
export type Limits = typeof LIMITS;
export function describeLimits(l: Limits = LIMITS) {
  return {
    max_file_bytes: l.max_file_bytes,
    max_stored_bytes: l.max_stored_bytes,
    max_pending_uploads: l.max_pending_uploads,
    free_stored_bytes: l.free_stored_bytes,
    free_transfers_per_30_days: l.free_transfers_per_30_days,
    retention_days: Math.round(l.retention_ms / DAY),
    price_cents_per_gb: PRICE_CENTS_PER_GB,
    minimum_charge_cents: MINIMUM_CHARGE_CENTS,
    top_up_packs: TOP_UP_PACKS,
    credit_validity_years: CREDIT_VALIDITY_YEARS,
  };
}
// Priced transfers: the sender names a price in cents; Bilaga keeps a fee when
// it settles. Balances are integer cents and never go negative.
export const MAX_PRICE_CENTS = 1_000_000;
export const FEE_BPS = 500;
export const feeCents = (price: number) => Math.floor((price * FEE_BPS) / 10_000);
export const validPrice = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_PRICE_CENTS;
export function quoteCents(bytes: number) {
  return Math.max(MINIMUM_CHARGE_CENTS, Math.ceil((bytes * PRICE_CENTS_PER_GB) / 1_000_000_000));
}
export function validSize(bytes: unknown): bytes is number {
  return (
    typeof bytes === 'number' &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    bytes <= MAX_BYTES
  );
}
// Round limits for copy ("5 GB"); fileLabel is for actual transfer sizes.
export const gbLabel = (bytes: number) => `${bytes / 1e9} GB`;
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

export function creditExpiry(purchasedAt: number) {
  const date = new Date(purchasedAt);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + CREDIT_VALIDITY_YEARS);
  // February 29 purchases expire on February 28 in a non-leap year.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
}
