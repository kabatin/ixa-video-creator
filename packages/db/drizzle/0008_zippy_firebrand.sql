CREATE TABLE "storyboard_draft_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"description" text NOT NULL,
	"mood" text,
	"reason" text NOT NULL,
	"adopted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storyboard_draft_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"drafter" text NOT NULL,
	"status" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storyboard_draft_items" ADD CONSTRAINT "storyboard_draft_items_run_id_storyboard_draft_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."storyboard_draft_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_draft_items" ADD CONSTRAINT "storyboard_draft_items_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_draft_runs" ADD CONSTRAINT "storyboard_draft_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storyboard_draft_items_run_id_idx" ON "storyboard_draft_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "storyboard_draft_items_shot_id_idx" ON "storyboard_draft_items" USING btree ("shot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_draft_items_run_shot_uidx" ON "storyboard_draft_items" USING btree ("run_id","shot_id");--> statement-breakpoint
CREATE INDEX "storyboard_draft_runs_project_id_idx" ON "storyboard_draft_runs" USING btree ("project_id");