CREATE TABLE "upscale_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"source_take_id" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"take_id" text,
	"error" jsonb,
	"estimate_seconds" double precision,
	"provider_record" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "upscale_jobs" ADD CONSTRAINT "upscale_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upscale_jobs" ADD CONSTRAINT "upscale_jobs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upscale_jobs" ADD CONSTRAINT "upscale_jobs_source_take_id_takes_id_fk" FOREIGN KEY ("source_take_id") REFERENCES "public"."takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upscale_jobs" ADD CONSTRAINT "upscale_jobs_take_id_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."takes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upscale_jobs_shot_id_idx" ON "upscale_jobs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "upscale_jobs_source_take_id_idx" ON "upscale_jobs" USING btree ("source_take_id");--> statement-breakpoint
CREATE INDEX "upscale_jobs_project_status_idx" ON "upscale_jobs" USING btree ("project_id","status");