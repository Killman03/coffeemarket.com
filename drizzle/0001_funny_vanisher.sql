CREATE TABLE `site_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "site_owner_singleton" CHECK("site_owner"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`write_id` text NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK("site_settings"."id"=1),
	CONSTRAINT "site_settings_revision_positive" CHECK("site_settings"."revision">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_write_id` ON `site_settings` (`write_id`);--> statement-breakpoint
CREATE TABLE `site_settings_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	`changed_sections` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_audit_revision` ON `site_settings_audit` (`revision`);--> statement-breakpoint
CREATE INDEX `site_settings_audit_created` ON `site_settings_audit` (`created_at`);