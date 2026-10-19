CREATE TABLE "uploaded_sfx_sounds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "uploaded_sfx_sounds" ADD CONSTRAINT "uploaded_sfx_sounds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_sfx_sounds" ADD CONSTRAINT "uploaded_sfx_sounds_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploaded_sfx_sounds_project_id_idx" ON "uploaded_sfx_sounds" USING btree ("project_id");