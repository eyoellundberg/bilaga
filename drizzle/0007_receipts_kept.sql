ALTER TABLE `transfers` ADD `receipt_requests` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_transfers_content_hash` ON `transfers` (`content_hash`);