CREATE TABLE "rotation_queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playback_log" ADD COLUMN "listener_peak" integer;--> statement-breakpoint
ALTER TABLE "playback_log" ADD COLUMN "listener_total" integer;--> statement-breakpoint
ALTER TABLE "playback_log" ADD COLUMN "listener_samples" integer;--> statement-breakpoint
ALTER TABLE "playback_log" ADD COLUMN "rotation_outcome" text;--> statement-breakpoint
ALTER TABLE "rotation_queue_entries" ADD CONSTRAINT "rotation_queue_entries_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;