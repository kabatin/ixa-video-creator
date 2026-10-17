CREATE TABLE "sfx_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool" text NOT NULL,
	"model" text,
	"spec" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" jsonb,
	"provider_record" jsonb,
	"media_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline_clip_id" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "sfx_tool" text DEFAULT 'stub' NOT NULL;--> statement-breakpoint
ALTER TABLE "sfx_jobs" ADD CONSTRAINT "sfx_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sfx_jobs_project_status_idx" ON "sfx_jobs" USING btree ("project_id","status");