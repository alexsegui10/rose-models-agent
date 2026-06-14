ALTER TABLE "candidates" ADD COLUMN "scheduled_call_slot" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "face_objection_count" integer DEFAULT 0 NOT NULL;