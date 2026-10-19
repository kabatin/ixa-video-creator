CREATE TABLE "image_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"image_job_id" text NOT NULL,
	"outcome" text NOT NULL,
	"verdict" text,
	"score" double precision,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_delta" text,
	"note" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "retry_of_job_id" text;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "image_checks" ADD CONSTRAINT "image_checks_image_job_id_image_generation_jobs_id_fk" FOREIGN KEY ("image_job_id") REFERENCES "public"."image_generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_checks_image_job_id_idx" ON "image_checks" USING btree ("image_job_id");--> statement-breakpoint
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_retry_of_job_id_image_generation_jobs_id_fk" FOREIGN KEY ("retry_of_job_id") REFERENCES "public"."image_generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_generation_jobs_retry_of_job_id_idx" ON "image_generation_jobs" USING btree ("retry_of_job_id");--> statement-breakpoint
CREATE INDEX "image_generation_jobs_media_asset_id_idx" ON "image_generation_jobs" USING btree ("media_asset_id");