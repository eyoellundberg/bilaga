CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`delivered_at` integer,
	`last_status` integer
);
--> statement-breakpoint
CREATE INDEX `idx_events_account_created` ON `events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_pending` ON `events` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`account_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `handle` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_handle_unique` ON `accounts` (`handle`);--> statement-breakpoint
ALTER TABLE `transfers` ADD `recipient` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `transfers` ADD `received_by` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `in_reply_to` text;--> statement-breakpoint
CREATE INDEX `idx_transfers_recipient` ON `transfers` (`recipient`,`completed_at`);--> statement-breakpoint
UPDATE `accounts` SET `handle`='acct_'||lower(hex(randomblob(8))) WHERE `handle` IS NULL AND `deleted_at` IS NULL;
