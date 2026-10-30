CREATE TABLE "check_bundles" (
	"bundle_id" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_bundles_bundle_id_version_pk" PRIMARY KEY("bundle_id","version")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"producer_id" text NOT NULL,
	"producer_seq" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_session_seq_unique" UNIQUE("session_id","seq"),
	CONSTRAINT "events_session_event_id_unique" UNIQUE("session_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"public_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"goal" text NOT NULL,
	"client" jsonb NOT NULL,
	"agent" text,
	"coverage" text NOT NULL,
	"data_label" text NOT NULL,
	"run_status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"next_seq" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tool_descriptors" (
	"tool" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_descriptors_tool_version_pk" PRIMARY KEY("tool","version")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_session_producer_seq_idx" ON "events" USING btree ("session_id","producer_id","producer_seq");