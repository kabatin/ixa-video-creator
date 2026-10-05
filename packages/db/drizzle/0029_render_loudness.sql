ALTER TABLE "render_jobs" ADD COLUMN "normalize_loudness" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD COLUMN "loudness_lufs" double precision;