ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'mv' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "demo_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_demo_key_live_uidx" ON "projects" USING btree ("workspace_id","demo_key") WHERE "projects"."deleted_at" IS NULL AND "projects"."demo_key" IS NOT NULL;