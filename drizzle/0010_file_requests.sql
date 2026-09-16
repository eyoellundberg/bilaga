CREATE TABLE `file_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`token_hash` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`max_files` integer NOT NULL,
	`max_file_bytes` integer NOT NULL,
	`max_total_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`submitted_at` integer,
	`submission_event_id` text,
	`revoked_at` integer,
	`uploader_email` text,
	`manifest` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_requests_token_hash_unique` ON `file_requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_file_requests_owner` ON `file_requests` (`owner`,`created_at`);--> statement-breakpoint
ALTER TABLE `transfers` ADD `request_id` text;--> statement-breakpoint
CREATE INDEX `idx_transfers_request` ON `transfers` (`request_id`,`created_at`);