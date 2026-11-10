ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'mv' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "demo_key" text;