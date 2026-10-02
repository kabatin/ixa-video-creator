ALTER TABLE "image_generation_jobs" ALTER COLUMN "shot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "kind" text DEFAULT 'start_frame' NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "character_id" text;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_generation_jobs_character_id_idx" ON "image_generation_jobs" USING btree ("character_id");