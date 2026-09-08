CREATE TABLE `rate_limits` (
	`scope` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_reset` ON `rate_limits` (`reset_at`);--> statement-breakpoint
ALTER TABLE `parts` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `purged_at` integer;--> statement-breakpoint
ALTER TABLE `transfers` ADD `completion_lock_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_transfers_pending_cleanup` ON `transfers` (`purged_at`,`expires_at`);