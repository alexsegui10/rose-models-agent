CREATE TABLE "call_turn_memory" (
	"call_key" text NOT NULL,
	"turn_index" integer NOT NULL,
	"utterance" text NOT NULL,
	"signal" text NOT NULL,
	"refined_by_understander" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_turn_memory_pk" PRIMARY KEY("call_key","turn_index")
);
