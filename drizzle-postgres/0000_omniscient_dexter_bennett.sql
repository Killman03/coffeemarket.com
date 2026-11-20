CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" bigint NOT NULL,
	"write_id" uuid NOT NULL,
	CONSTRAINT "analytics_events_sequence_positive" CHECK ("analytics_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pnl_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"rate_key" text NOT NULL,
	"chat_id" bigint,
	"user_id" bigint,
	"state" text NOT NULL,
	"phone" text NOT NULL,
	"consent_text" text NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" bigint NOT NULL,
	"analytics_session_id" uuid,
	CONSTRAINT "pnl_requests_state_valid" CHECK ("pnl_requests"."state" IN ('pending', 'sending', 'delivered', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "pnl_updates" (
	"id" bigint PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "pnl_updates_status_valid" CHECK ("pnl_updates"."status" IN ('pending', 'processing', 'done'))
);
--> statement-breakpoint
CREATE TABLE "site_owner" (
	"id" integer PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "site_owner_singleton" CHECK ("site_owner"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	"updated_by" text NOT NULL,
	"write_id" uuid NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK ("site_settings"."id" = 1),
	CONSTRAINT "site_settings_revision_positive" CHECK ("site_settings"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "site_settings_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"actor" text NOT NULL,
	"created_at" bigint NOT NULL,
	"changed_sections" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_requests" ADD CONSTRAINT "pnl_requests_analytics_session_id_analytics_sessions_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_created" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session" ON "analytics_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_started" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_source" ON "analytics_sessions" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "pnl_requests_rate" ON "pnl_requests" USING btree ("rate_key","created_at");--> statement-breakpoint
CREATE INDEX "pnl_requests_created" ON "pnl_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pnl_requests_user" ON "pnl_requests" USING btree ("chat_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "pnl_requests_analytics" ON "pnl_requests" USING btree ("analytics_session_id","created_at");--> statement-breakpoint
CREATE INDEX "pnl_updates_created" ON "pnl_updates" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_settings_write_id" ON "site_settings" USING btree ("write_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_settings_audit_revision" ON "site_settings_audit" USING btree ("revision");--> statement-breakpoint
CREATE INDEX "site_settings_audit_created" ON "site_settings_audit" USING btree ("created_at");