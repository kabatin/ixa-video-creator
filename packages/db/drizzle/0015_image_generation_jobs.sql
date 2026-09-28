CREATE TABLE "image_generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"reference_asset_ids" text[] DEFAULT '{}' NOT NULL,
	"media_asset_id" text,
	"error" jsonb,
	"provider_record" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_generation_jobs_shot_id_idx" ON "image_generation_jobs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "image_generation_jobs_project_status_idx" ON "image_generation_jobs" USING btree ("project_id","status");