-- ADR-0062 段 5b: 声の差し替え。
-- dub_jobs は追記のみ（状態の遷移とそのとき決まる列だけを書く）。tts_clips は読み上げの保存（ワークスペースごと。声・読み方・文が同じなら読み直さない）。
-- characters のセリフの声と距離の既定、voice_profiles の作った声（説明・性別・作った鍵の名札。鍵そのものではない）。
-- 前からの行は「セリフの声なし・距離 0 dB・既製の声」で読める。
CREATE TABLE "dub_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"source_take_id" text NOT NULL,
	"status" text NOT NULL,
	"take_id" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" jsonb,
	"record" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tts_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"duration_sec" double precision NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "dialogue_voice_profile_id" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "dialogue_level_db" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD COLUMN "designed_voice" jsonb;--> statement-breakpoint
ALTER TABLE "dub_jobs" ADD CONSTRAINT "dub_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dub_jobs" ADD CONSTRAINT "dub_jobs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dub_jobs" ADD CONSTRAINT "dub_jobs_source_take_id_takes_id_fk" FOREIGN KEY ("source_take_id") REFERENCES "public"."takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dub_jobs" ADD CONSTRAINT "dub_jobs_take_id_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."takes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_clips" ADD CONSTRAINT "tts_clips_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_clips" ADD CONSTRAINT "tts_clips_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dub_jobs_shot_id_idx" ON "dub_jobs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "dub_jobs_project_status_idx" ON "dub_jobs" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_clips_workspace_cache_key_uidx" ON "tts_clips" USING btree ("workspace_id","cache_key");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_dialogue_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("dialogue_voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;