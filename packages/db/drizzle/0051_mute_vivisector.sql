ALTER TABLE "image_generation_jobs" DROP CONSTRAINT "image_generation_jobs_retry_of_job_id_image_generation_jobs_id_fk";
--> statement-breakpoint
DROP INDEX "image_generation_jobs_retry_of_job_id_idx";--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_retry_of_job_id_image_generation_jobs_id_fk" FOREIGN KEY ("retry_of_job_id") REFERENCES "public"."image_generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_generation_jobs_retry_of_job_id_uidx" ON "image_generation_jobs" USING btree ("retry_of_job_id") WHERE "image_generation_jobs"."retry_of_job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uploaded_sfx_sounds_project_id_media_asset_id_uidx" ON "uploaded_sfx_sounds" USING btree ("project_id","media_asset_id") WHERE "uploaded_sfx_sounds"."deleted_at" is null;