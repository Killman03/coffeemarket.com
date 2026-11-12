CREATE TABLE `pnl_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`rate_key` text NOT NULL,
	`chat_id` integer,
	`user_id` integer,
	`state` text NOT NULL,
	`phone` text NOT NULL,
	`consent_text` text NOT NULL,
	`consent_version` text NOT NULL,
	`consented_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pnl_requests_rate` ON `pnl_requests` (`rate_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `pnl_requests_created` ON `pnl_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `pnl_requests_user` ON `pnl_requests` (`chat_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pnl_updates` (
	`id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pnl_updates_created` ON `pnl_updates` (`created_at`);