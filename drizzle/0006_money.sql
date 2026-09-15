CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`delta_cents` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`kind` text NOT NULL,
	`transfer_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_account_created` ON `ledger` (`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_login_method` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `price_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transfers` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `transfers` ADD `paid_by` text;