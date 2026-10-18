ALTER TABLE "shot_edit_batches" ADD COLUMN "music_entries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "end_sec" double precision;