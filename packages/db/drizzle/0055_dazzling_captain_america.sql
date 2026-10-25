ALTER TABLE "takes" ADD COLUMN "sent_prompt" jsonb;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "sent_prompt" text;--> statement-breakpoint
ALTER TABLE "voice_jobs" ADD COLUMN "sent_style" text;