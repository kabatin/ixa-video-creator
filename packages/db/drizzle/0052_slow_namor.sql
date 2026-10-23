ALTER TABLE "generation_jobs" ADD COLUMN "auto_retake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "takes" ADD COLUMN "auto_retake" boolean DEFAULT false NOT NULL;