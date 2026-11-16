CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`sequence` integer NOT NULL,
	`market` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`write_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `analytics_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_events_sequence_positive" CHECK("analytics_events"."sequence">0)
);
--> statement-breakpoint
CREATE INDEX `analytics_events_created` ON `analytics_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_session` ON `analytics_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `analytics_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`source` text NOT NULL,
	`medium` text NOT NULL,
	`campaign` text NOT NULL,
	`market` text NOT NULL,
	`currency` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_sessions_started` ON `analytics_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `analytics_sessions_source` ON `analytics_sessions` (`source`,`started_at`);--> statement-breakpoint
ALTER TABLE `pnl_requests` ADD `analytics_session_id` text;--> statement-breakpoint
CREATE INDEX `pnl_requests_analytics` ON `pnl_requests` (`analytics_session_id`,`created_at`);