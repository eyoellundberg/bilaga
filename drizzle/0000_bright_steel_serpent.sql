CREATE TABLE `parts` (
	`transfer_id` text NOT NULL,
	`number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`transfer_id`, `number`),
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`owner` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`sender` text,
	`upload_id` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`sent_at` integer,
	`download_requests` integer DEFAULT 0 NOT NULL,
	`last_download_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_public_id_unique` ON `transfers` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_owner_created` ON `transfers` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transfers_expiry` ON `transfers` (`expires_at`);