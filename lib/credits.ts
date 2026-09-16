import { env } from 'cloudflare:workers';
import { DAY, usd } from './rules';

export async function expireCredits(accountId?: string) {
  const now = Date.now();
  // The trigger atomically adjusts the balance and zeroes the lot. Stable ids
  // make overlapping scheduler/request sweeps idempotent.
  await env.DB.prepare(`INSERT OR IGNORE INTO ledger
    (id,account_id,delta_cents,balance_after,kind,credit_lot_id,note,created_at)
    SELECT 'expiry_'||id,account_id,-remaining_cents,0,'expiry',id,'Unused transfer credit expired',?
    FROM credit_lots WHERE remaining_cents>0 AND expires_at<=? AND (? IS NULL OR account_id=?)
    ORDER BY expires_at,id LIMIT 100`).bind(now, now, accountId ?? null, accountId ?? null).run();
}
export async function creditSummary(accountId: string) {
  await expireCredits(accountId);
  const now = Date.now();
  const lots = (await env.DB.prepare(`SELECT id,source,remaining_cents,created_at,expires_at FROM credit_lots
    WHERE account_id=? AND remaining_cents>0 AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at,id`)
    .bind(accountId, now).all<{ id: string; source: string; remaining_cents: number; created_at: number; expires_at: number | null }>()).results;
  return { balance_cents: lots.reduce((sum, lot) => sum + lot.remaining_cents, 0), credit_lots: lots };
}
export async function remindExpiringCredits(limit = 25) {
  const email = (env as unknown as { EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> } }).EMAIL;
  if (!email) return 0;
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const now = Date.now();
    // Claim immediately before sending, with retry after failure/crash.
    const lease = now + 10 * 60_000;
    const lots = (await env.DB.prepare(`UPDATE credit_lots SET reminder_lease_until=?
      WHERE remaining_cents>0 AND reminder_sent_at IS NULL AND reminder_lease_until<=?
      AND (account_id,expires_at) IN (
      SELECT c.account_id,c.expires_at FROM credit_lots c JOIN accounts a ON a.id=c.account_id
      WHERE a.deleted_at IS NULL AND a.email IS NOT NULL AND c.remaining_cents>0 AND c.expires_at>? AND c.expires_at<=?
      AND c.reminder_sent_at IS NULL AND c.reminder_lease_until<=? ORDER BY c.expires_at,c.id LIMIT 1
    ) RETURNING id,account_id,remaining_cents,expires_at`)
      .bind(lease, now, now, now + 30 * DAY, now)
      .all<{ id: string; account_id: string; remaining_cents: number; expires_at: number }>()).results;
    const lot = lots[0];
    if (!lot) break;
    const remaining = lots.reduce((sum, item) => sum + item.remaining_cents, 0);
    const account = await env.DB.prepare('SELECT email FROM accounts WHERE id=? AND deleted_at IS NULL').bind(lot.account_id).first<{ email: string }>();
    if (!account?.email) continue;
    try {
      await email.send({
        from: 'login@bilaga.link', to: account.email,
        subject: 'Your Bilaga credit expires soon',
        text: `${usd(remaining)} of your unused Bilaga transfer credit expires on ${new Date(lot.expires_at).toISOString().slice(0, 10)} (UTC). Credits are used oldest first. View your current balance and expiry dates at https://bilaga.link/account. You do not need to buy more credit.`,
      });
      await env.DB.prepare('UPDATE credit_lots SET reminder_sent_at=? WHERE account_id=? AND expires_at=? AND reminder_lease_until=?')
        .bind(Date.now(), lot.account_id, lot.expires_at, lease).run();
      sent++;
    } catch {
      console.error('Credit expiry reminder needs retry');
    }
  }
  return sent;
}
