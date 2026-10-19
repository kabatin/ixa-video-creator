CREATE TABLE "take_motion_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"take_id" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"status" text NOT NULL,
	"energy_hop_sec" double precision NOT NULL,
	"energy" double precision[] DEFAULT '{}' NOT NULL,
	"onsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vision_used" boolean NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "take_motion_analyses" ADD CONSTRAINT "take_motion_analyses_take_id_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "take_motion_analyses_take_id_idx" ON "take_motion_analyses" USING btree ("take_id");