ALTER TABLE "generation_jobs" ADD COLUMN "parent_take_id" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "regeneration_reason" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_parent_take_id_takes_id_fk" FOREIGN KEY ("parent_take_id") REFERENCES "public"."takes"("id") ON DELETE set null ON UPDATE no action;