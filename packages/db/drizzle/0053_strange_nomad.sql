CREATE TABLE "agent_messages" (
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"cli_session_id" text,
	"status" text NOT NULL,
	"confirmations_waived" boolean DEFAULT false NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"last_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_project_last_active_idx" ON "agent_sessions" USING btree ("project_id","last_active_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_project_busy_uidx" ON "agent_sessions" USING btree ("project_id") WHERE "agent_sessions"."status" in ('running', 'awaiting_approval');