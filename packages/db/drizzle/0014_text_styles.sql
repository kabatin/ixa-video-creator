CREATE TABLE "text_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"style" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "text_styles" ADD CONSTRAINT "text_styles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_styles_project_id_idx" ON "text_styles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "text_styles_project_id_name_uidx" ON "text_styles" USING btree ("project_id","name") WHERE "text_styles"."deleted_at" is null;