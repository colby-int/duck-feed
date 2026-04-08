ALTER TABLE "episodes" ADD COLUMN "presenter" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "auto_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "auto_queue_request_id" text;--> statement-breakpoint
UPDATE "episodes"
SET "presenter" = NULLIF(BTRIM(REGEXP_REPLACE("description", '^Presenter:\s*', '')), '')
WHERE "presenter" IS NULL
  AND "description" ~ '^Presenter:\s*';--> statement-breakpoint
UPDATE "episodes"
SET "presenter" = NULLIF(
  BTRIM(
    INITCAP(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          (regexp_match("original_filename", '^\d{2}\d{2}(?:\d{2}|\d{4})_[^_]+_([^_]+)\.[^.]+$'))[1],
          '[-.]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    )
  ),
  ''
)
WHERE "presenter" IS NULL
  AND "original_filename" ~ '^\d{2}\d{2}(?:\d{2}|\d{4})_[^_]+_[^_]+\.[^.]+$';--> statement-breakpoint
UPDATE "episodes"
SET "description" = NULL
WHERE "description" ~ '^Presenter:\s*';
