CREATE TABLE "thumbnails" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text NOT NULL,
	"output_asset_id" text,
	"file_name" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "instruction" text;--> statement-breakpoint
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_output_asset_id_media_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thumbnails_project_id_idx" ON "thumbnails" USING btree ("project_id");