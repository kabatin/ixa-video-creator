CREATE TABLE "music_analysis_failures" (
	"music_track_id" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_analysis_failures" ADD CONSTRAINT "music_analysis_failures_music_track_id_music_tracks_id_fk" FOREIGN KEY ("music_track_id") REFERENCES "public"."music_tracks"("id") ON DELETE cascade ON UPDATE no action;