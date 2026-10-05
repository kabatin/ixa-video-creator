CREATE TABLE "narration_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"text" text NOT NULL,
	"reading" text,
	"voice_profile_id" text,
	"direction" text DEFAULT '' NOT NULL,
	"start_sec" double precision,
	"selected_take_id" text,
	"telop" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "narration_takes" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"take_index" integer NOT NULL,
	"source" jsonb NOT NULL,
	"media_asset_id" text NOT NULL,
	"in_sec" double precision NOT NULL,
	"out_sec" double precision NOT NULL,
	"spoken_text" text NOT NULL,
	"display_text" text NOT NULL,
	"spec_hash" text,
	"char_times" jsonb,
	"loudness_lufs" double precision,
	"peaks" jsonb,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_audio_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"reading_dictionary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ducking" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"line_id" text,
	"take_id" text,
	"voice_profile_id" text,
	"input_media_asset_id" text,
	"result_media_asset_id" text,
	"place_at_sec" double precision,
	"tool" text NOT NULL,
	"model" text,
	"spec" jsonb,
	"status" text NOT NULL,
	"cost_usd" double precision,
	"error" jsonb,
	"provider_record" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"tool" text NOT NULL,
	"model" text,
	"voice_name" text NOT NULL,
	"style_note" text DEFAULT '' NOT NULL,
	"speed" double precision DEFAULT 1 NOT NULL,
	"volume" double precision DEFAULT 1 NOT NULL,
	"language" text DEFAULT 'ja' NOT NULL,
	"tuning" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text_style_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "narration_lines" ADD CONSTRAINT "narration_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_lines" ADD CONSTRAINT "narration_lines_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_lines" ADD CONSTRAINT "narration_lines_selected_take_id_narration_takes_id_fk" FOREIGN KEY ("selected_take_id") REFERENCES "public"."narration_takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_takes" ADD CONSTRAINT "narration_takes_line_id_narration_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."narration_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_takes" ADD CONSTRAINT "narration_takes_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_audio_settings" ADD CONSTRAINT "project_audio_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_line_id_narration_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."narration_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_take_id_narration_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."narration_takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_input_media_asset_id_media_assets_id_fk" FOREIGN KEY ("input_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD CONSTRAINT "voice_jobs_result_media_asset_id_media_assets_id_fk" FOREIGN KEY ("result_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_text_style_id_text_styles_id_fk" FOREIGN KEY ("text_style_id") REFERENCES "public"."text_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "narration_lines_project_id_idx" ON "narration_lines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_takes_line_id_take_index_uidx" ON "narration_takes" USING btree ("line_id","take_index");--> statement-breakpoint
CREATE INDEX "narration_takes_spec_hash_idx" ON "narration_takes" USING btree ("line_id","spec_hash");--> statement-breakpoint
CREATE INDEX "voice_jobs_project_status_idx" ON "voice_jobs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "voice_jobs_line_id_idx" ON "voice_jobs" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_project_id_idx" ON "voice_profiles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_project_id_name_uidx" ON "voice_profiles" USING btree ("project_id","name") WHERE "voice_profiles"."deleted_at" is null;