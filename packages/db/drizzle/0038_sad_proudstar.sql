CREATE TABLE "music_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool" text NOT NULL,
	"model" text,
	"spec" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" jsonb,
	"provider_record" jsonb,
	"music_track_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "music_tool" text DEFAULT 'stub' NOT NULL;--> statement-breakpoint
ALTER TABLE "music_jobs" ADD CONSTRAINT "music_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_jobs_project_status_idx" ON "music_jobs" USING btree ("project_id","status");