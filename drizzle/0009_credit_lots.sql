CREATE TABLE `credit_allocations` (
	`ledger_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`cents` integer NOT NULL,
	PRIMARY KEY(`ledger_id`, `lot_id`)
);
--> statement-breakpoint
CREATE TABLE `credit_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`original_cents` integer NOT NULL,
	`remaining_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`reminder_sent_at` integer,
	`reminder_lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credit_lots_account` ON `credit_lots` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_credit_lots_expiry` ON `credit_lots` (`expires_at`);--> statement-breakpoint
ALTER TABLE `ledger` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `ledger` ADD `paid_cents` integer;--> statement-breakpoint
ALTER TABLE `ledger` ADD `credit_lot_id` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `settlement_id` text;
--> statement-breakpoint
-- Preserve all pre-migration balances under their existing, non-expiring terms.
INSERT INTO credit_lots (id,account_id,source,original_cents,remaining_cents,created_at)
SELECT 'legacy_'||id,id,'legacy',balance_cents,balance_cents,created_at FROM accounts WHERE balance_cents>0;
--> statement-breakpoint
-- Ledger inserts and lot changes share the caller's transaction. Never run
-- spending as a read/modify/write loop in application code.
CREATE TRIGGER credit_add AFTER INSERT ON ledger
WHEN NEW.delta_cents>0 AND NEW.kind NOT IN ('refund','fee')
BEGIN
  INSERT INTO credit_lots(id,account_id,source,original_cents,remaining_cents,created_at,expires_at)
  VALUES(NEW.id||'_paid',NEW.account_id,NEW.kind,
    COALESCE(NEW.paid_cents,NEW.delta_cents),COALESCE(NEW.paid_cents,NEW.delta_cents),NEW.created_at,NEW.expires_at);
  INSERT INTO credit_lots(id,account_id,source,original_cents,remaining_cents,created_at,expires_at)
  SELECT NEW.id||'_promo',NEW.account_id,'promotion',NEW.delta_cents-NEW.paid_cents,NEW.delta_cents-NEW.paid_cents,NEW.created_at,NEW.expires_at
  WHERE NEW.paid_cents IS NOT NULL AND NEW.delta_cents>NEW.paid_cents;
END;
--> statement-breakpoint
CREATE TRIGGER credit_spend BEFORE INSERT ON ledger
WHEN NEW.delta_cents<0 AND NEW.kind<>'expiry'
BEGIN
  SELECT CASE WHEN -NEW.delta_cents>COALESCE((SELECT SUM(remaining_cents) FROM credit_lots WHERE account_id=NEW.account_id AND (expires_at IS NULL OR expires_at>NEW.created_at)),0)
    THEN RAISE(ABORT,'insufficient_credit') END;
  INSERT INTO credit_allocations(ledger_id,lot_id,cents)
  SELECT NEW.id,id,MIN(remaining_cents,MAX(0,-NEW.delta_cents-used)) FROM (
    SELECT id,remaining_cents,COALESCE(SUM(remaining_cents) OVER (ORDER BY created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS used
    FROM credit_lots WHERE account_id=NEW.account_id AND remaining_cents>0 AND (expires_at IS NULL OR expires_at>NEW.created_at)
  ) WHERE used < -NEW.delta_cents;
  UPDATE credit_lots SET remaining_cents=remaining_cents-COALESCE((SELECT cents FROM credit_allocations WHERE ledger_id=NEW.id AND lot_id=credit_lots.id),0)
  WHERE id IN (SELECT lot_id FROM credit_allocations WHERE ledger_id=NEW.id);
END;
--> statement-breakpoint
-- Restore the exact sources of an abandoned upload. Expired portions stay
-- expired; returning a transfer must never renew purchased credit.
CREATE TRIGGER credit_refund AFTER INSERT ON ledger
WHEN NEW.kind='refund'
BEGIN
  UPDATE accounts SET balance_cents=balance_cents-NEW.delta_cents+COALESCE((
    SELECT SUM(a.cents) FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id JOIN credit_lots c ON c.id=a.lot_id
    WHERE l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge' AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
  ),0) WHERE id=NEW.account_id AND EXISTS(SELECT 1 FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id WHERE l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge');
  UPDATE ledger SET delta_cents=COALESCE((
    SELECT SUM(a.cents) FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id JOIN credit_lots c ON c.id=a.lot_id
    WHERE l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge' AND (c.expires_at IS NULL OR c.expires_at>NEW.created_at)
  ),0),balance_after=(SELECT balance_cents FROM accounts WHERE id=NEW.account_id)
  WHERE id=NEW.id AND EXISTS(SELECT 1 FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id WHERE l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge');
  UPDATE credit_lots SET remaining_cents=remaining_cents+COALESCE((
    SELECT SUM(a.cents) FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id
    WHERE a.lot_id=credit_lots.id AND l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge'
  ),0) WHERE account_id=NEW.account_id AND (expires_at IS NULL OR expires_at>NEW.created_at);
  -- Charges made before this migration have no allocations.
  INSERT INTO credit_lots(id,account_id,source,original_cents,remaining_cents,created_at)
  SELECT NEW.id,NEW.account_id,'legacy_refund',NEW.delta_cents,NEW.delta_cents,NEW.created_at
  WHERE NOT EXISTS(SELECT 1 FROM credit_allocations a JOIN ledger l ON l.id=a.ledger_id WHERE l.account_id=NEW.account_id AND l.transfer_id=NEW.transfer_id AND l.kind='charge');
END;
--> statement-breakpoint
CREATE TRIGGER credit_expire AFTER INSERT ON ledger
WHEN NEW.kind='expiry'
BEGIN
  UPDATE accounts SET balance_cents=balance_cents+NEW.delta_cents WHERE id=NEW.account_id;
  UPDATE ledger SET balance_after=COALESCE((SELECT balance_cents FROM accounts WHERE id=NEW.account_id),0) WHERE id=NEW.id;
  UPDATE credit_lots SET remaining_cents=0 WHERE id=NEW.credit_lot_id;
END;
