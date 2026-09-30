CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"text_tool" text NOT NULL,
	"image_tool" text NOT NULL,
	"video_tool" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_single_row" CHECK ("ai_settings"."id" = 'default')
);
