CREATE TABLE "character_identity_images" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"role" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_look_images" (
	"id" text PRIMARY KEY NOT NULL,
	"look_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"role" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_looks" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"era" text,
	"description" text DEFAULT '' NOT NULL,
	"wardrobe_tokens" text[] DEFAULT '{}' NOT NULL,
	"style_tokens" text[] DEFAULT '{}' NOT NULL,
	"color_palette" text[] DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"canonical_frame_asset_id" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"identity_anchors" text[] DEFAULT '{}' NOT NULL,
	"style_tokens" text[] DEFAULT '{}' NOT NULL,
	"color_palette" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"shot_id" text NOT NULL,
	"spec_hash" text NOT NULL,
	"requested_model" text NOT NULL,
	"resolved_model" text,
	"router_decision" jsonb,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"provider_job_ref" text,
	"error" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "takes" (
	"id" text PRIMARY KEY NOT NULL,
	"shot_id" text NOT NULL,
	"index" integer NOT NULL,
	"media_asset_id" text NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_params" jsonb NOT NULL,
	"seed_used" integer,
	"cost_usd" double precision NOT NULL,
	"generation_time_sec" double precision NOT NULL,
	"parent_take_id" text,
	"regeneration_reason" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"human_verdict" text DEFAULT 'unreviewed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"fps" integer NOT NULL,
	"resolution" jsonb NOT NULL,
	"aspect_ratio" text NOT NULL,
	"duration_sec" double precision,
	"budget_usd" double precision,
	"style_guide" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"probe" jsonb,
	"proxy_key" text,
	"thumbnail_key" text,
	"poster_keys" text[] DEFAULT '{}' NOT NULL,
	"origin" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"media_asset_id" text,
	"value" text,
	"usage_rule" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference_asset_ids" text[] DEFAULT '{}' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "motion_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"params_schema" jsonb NOT NULL,
	"preview_asset_id" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "music_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"music_track_id" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"bpm" double precision NOT NULL,
	"bpm_confidence" double precision NOT NULL,
	"beats" jsonb NOT NULL,
	"downbeats" jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"energy_curve" jsonb NOT NULL,
	"onsets" double precision[] DEFAULT '{}' NOT NULL,
	"drops" double precision[] DEFAULT '{}' NOT NULL,
	"waveform_peaks_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"title" text NOT NULL,
	"is_master" boolean DEFAULT false NOT NULL,
	"offset_sec" double precision DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"authored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"current_version_id" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"order" integer NOT NULL,
	"name" text NOT NULL,
	"music_section_label" text,
	"notes" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shot_characters" (
	"shot_id" text NOT NULL,
	"character_id" text NOT NULL,
	"look_id" text NOT NULL,
	"prominence" text NOT NULL,
	"order" integer NOT NULL,
	CONSTRAINT "shot_characters_shot_id_character_id_pk" PRIMARY KEY("shot_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "shot_references" (
	"id" text PRIMARY KEY NOT NULL,
	"shot_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"role" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"order" integer NOT NULL,
	"source_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sequence_id" text,
	"order" integer NOT NULL,
	"code" text NOT NULL,
	"start_sec" double precision NOT NULL,
	"duration_sec" double precision NOT NULL,
	"source_in_sec" double precision DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"dialogue" text,
	"camera" jsonb NOT NULL,
	"mood" text,
	"source_type" jsonb NOT NULL,
	"selected_take_id" text,
	"status" text NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"from_shot_id" text NOT NULL,
	"to_shot_id" text NOT NULL,
	"type" text NOT NULL,
	"duration_sec" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"review_run_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"severity" text NOT NULL,
	"score" double precision,
	"message" text NOT NULL,
	"evidence" jsonb,
	"suggested_prompt_delta" text
);
--> statement-breakpoint
CREATE TABLE "review_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"take_id" text NOT NULL,
	"reviewers" text[] DEFAULT '{}' NOT NULL,
	"status" text NOT NULL,
	"verdict" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"track" text NOT NULL,
	"start_sec" double precision NOT NULL,
	"duration_sec" double precision NOT NULL,
	"layer" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"opacity" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"scope" jsonb NOT NULL,
	"preset" text NOT NULL,
	"timeline_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"output_asset_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "character_identity_images" ADD CONSTRAINT "character_identity_images_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_identity_images" ADD CONSTRAINT "character_identity_images_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_look_images" ADD CONSTRAINT "character_look_images_look_id_character_looks_id_fk" FOREIGN KEY ("look_id") REFERENCES "public"."character_looks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_look_images" ADD CONSTRAINT "character_look_images_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_looks" ADD CONSTRAINT "character_looks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_looks" ADD CONSTRAINT "character_looks_canonical_frame_asset_id_media_assets_id_fk" FOREIGN KEY ("canonical_frame_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takes" ADD CONSTRAINT "takes_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takes" ADD CONSTRAINT "takes_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takes" ADD CONSTRAINT "takes_parent_take_id_takes_id_fk" FOREIGN KEY ("parent_take_id") REFERENCES "public"."takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_templates" ADD CONSTRAINT "motion_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_templates" ADD CONSTRAINT "motion_templates_preview_asset_id_media_assets_id_fk" FOREIGN KEY ("preview_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_analyses" ADD CONSTRAINT "music_analyses_music_track_id_music_tracks_id_fk" FOREIGN KEY ("music_track_id") REFERENCES "public"."music_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_current_version_id_script_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."script_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_look_id_character_looks_id_fk" FOREIGN KEY ("look_id") REFERENCES "public"."character_looks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_references" ADD CONSTRAINT "shot_references_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_references" ADD CONSTRAINT "shot_references_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_selected_take_id_takes_id_fk" FOREIGN KEY ("selected_take_id") REFERENCES "public"."takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_from_shot_id_shots_id_fk" FOREIGN KEY ("from_shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_to_shot_id_shots_id_fk" FOREIGN KEY ("to_shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_take_id_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_clips" ADD CONSTRAINT "timeline_clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_output_asset_id_media_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_identity_images_character_id_idx" ON "character_identity_images" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "character_look_images_look_id_idx" ON "character_look_images" USING btree ("look_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_looks_character_id_key_uidx" ON "character_looks" USING btree ("character_id","key");--> statement-breakpoint
CREATE INDEX "characters_workspace_id_idx" ON "characters" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_shot_id_idx" ON "generation_jobs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "takes_shot_id_index_uidx" ON "takes" USING btree ("shot_id","index");--> statement-breakpoint
CREATE INDEX "takes_spec_hash_idx" ON "takes" USING btree ("spec_hash");--> statement-breakpoint
CREATE INDEX "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_checksum_sha256_live_uidx" ON "media_assets" USING btree ("checksum_sha256") WHERE "media_assets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "media_assets_workspace_id_idx" ON "media_assets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "media_assets_project_id_idx" ON "media_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "brand_assets_workspace_id_idx" ON "brand_assets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "locations_workspace_id_idx" ON "locations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_templates_workspace_id_key_uidx" ON "motion_templates" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "music_analyses_music_track_id_idx" ON "music_analyses" USING btree ("music_track_id");--> statement-breakpoint
CREATE INDEX "music_tracks_project_id_idx" ON "music_tracks" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_versions_script_id_version_uidx" ON "script_versions" USING btree ("script_id","version");--> statement-breakpoint
CREATE INDEX "scripts_project_id_idx" ON "scripts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sequences_project_id_order_idx" ON "sequences" USING btree ("project_id","order");--> statement-breakpoint
CREATE INDEX "shot_references_shot_id_idx" ON "shot_references" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "shots_project_id_order_idx" ON "shots" USING btree ("project_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_project_id_code_uidx" ON "shots" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "transitions_from_shot_id_to_shot_id_uidx" ON "transitions" USING btree ("from_shot_id","to_shot_id");--> statement-breakpoint
CREATE INDEX "review_findings_review_run_id_idx" ON "review_findings" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_runs_take_id_idx" ON "review_runs" USING btree ("take_id");--> statement-breakpoint
CREATE INDEX "timeline_clips_project_id_track_idx" ON "timeline_clips" USING btree ("project_id","track");--> statement-breakpoint
CREATE INDEX "render_jobs_project_id_idx" ON "render_jobs" USING btree ("project_id");