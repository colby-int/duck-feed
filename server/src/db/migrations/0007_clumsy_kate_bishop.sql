CREATE TABLE "live_schedule_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_source" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"url" text,
	"display_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
