CREATE TABLE "ab_evaluation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blind" boolean DEFAULT true NOT NULL,
	"initial_state" text DEFAULT 'NEW_LEAD' NOT NULL,
	"profile_visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"messages" jsonb NOT NULL,
	"model_a" text NOT NULL,
	"model_b" text NOT NULL,
	"run_a" jsonb NOT NULL,
	"run_b" jsonb NOT NULL,
	"winner" text,
	"style_rating" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "approved_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"response" text NOT NULL,
	"state" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style_profile_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_version" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instagram_username" text NOT NULL,
	"display_name" text,
	"first_name" text,
	"age" integer,
	"is_adult_confirmed" boolean DEFAULT false NOT NULL,
	"country" text,
	"city" text,
	"phone" text,
	"device_type" text DEFAULT 'UNKNOWN' NOT NULL,
	"device_model" text,
	"device_eligibility" text DEFAULT 'UNKNOWN' NOT NULL,
	"commercial_tier" text DEFAULT 'STANDARD' NOT NULL,
	"declared_profile_visibility" text DEFAULT 'UNKNOWN' NOT NULL,
	"candidate_claims_follow_request_accepted" boolean DEFAULT false NOT NULL,
	"human_verified_profile_access" boolean DEFAULT false NOT NULL,
	"human_profile_review_status" text DEFAULT 'NOT_REVIEWED' NOT NULL,
	"human_fit_decision" text DEFAULT 'PENDING' NOT NULL,
	"has_only_fans" boolean,
	"works_with_another_agency" boolean,
	"experience_description" text,
	"current_monthly_revenue" double precision,
	"content_availability" text,
	"goals" text,
	"interest_level" text DEFAULT 'UNKNOWN' NOT NULL,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conversation_summary" text DEFAULT '' NOT NULL,
	"current_state" text DEFAULT 'NEW_LEAD' NOT NULL,
	"human_review_status" text DEFAULT 'NOT_REQUIRED' NOT NULL,
	"human_review_reason" text,
	"onboarding_blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"automation_paused" boolean DEFAULT false NOT NULL,
	"manual_control_active" boolean DEFAULT false NOT NULL,
	"generation_cancellation_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "candidates_instagram_username_unique" UNIQUE("instagram_username")
);
--> statement-breakpoint
CREATE TABLE "conversation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"message_id" uuid,
	"status" text NOT NULL,
	"original_response" text NOT NULL,
	"edited_response" text,
	"reason" text,
	"style_rating" integer,
	"state" text NOT NULL,
	"context_snapshot" text NOT NULL,
	"style_profile_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"role" text NOT NULL,
	"author" text NOT NULL,
	"content" text NOT NULL,
	"external_message_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"turn_feedback" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"playback_turns" jsonb,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "imported_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'ANONYMIZED_JSON' NOT NULL,
	"purpose" text NOT NULL,
	"category" text DEFAULT 'uncategorized' NOT NULL,
	"initial_state" text DEFAULT 'NEW_LEAD' NOT NULL,
	"state_before" text DEFAULT 'NEW_LEAD' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb NOT NULL,
	"original_alex_responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrected_responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"ideal_next_response" text,
	"notes" text,
	"outcome" text,
	"ended_in_call" boolean,
	"candidate_approved" boolean,
	"anonymized_personal_data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_decisions" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"requested_model_percentage" double precision,
	"current_policy_agency_percentage" double precision,
	"current_policy_model_percentage" double precision,
	"decision" text NOT NULL,
	"approved_agency_percentage" double precision,
	"approved_model_percentage" double precision,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"trigger" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approved_responses" ADD CONSTRAINT "approved_responses_feedback_id_conversation_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."conversation_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_feedback" ADD CONSTRAINT "conversation_feedback_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD CONSTRAINT "evaluation_sessions_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."imported_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_decisions" ADD CONSTRAINT "negotiation_decisions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approved_responses_feedback_id_idx" ON "approved_responses" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "conversation_feedback_candidate_id_idx" ON "conversation_feedback" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_candidate_id_idx" ON "conversation_messages" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_candidate_external_message_id_unique" ON "conversation_messages" USING btree ("candidate_id","external_message_id") WHERE "conversation_messages"."external_message_id" is not null;--> statement-breakpoint
CREATE INDEX "evaluation_sessions_conversation_id_idx" ON "evaluation_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "state_transitions_candidate_id_idx" ON "state_transitions" USING btree ("candidate_id");