ALTER TABLE "projects" ADD COLUMN "avoid" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "style_reference_asset_ids" text[] DEFAULT '{}' NOT NULL;