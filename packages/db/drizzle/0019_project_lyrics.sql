ALTER TABLE "projects" ADD COLUMN "lyrics" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lyric_cues" double precision[] DEFAULT '{}' NOT NULL;