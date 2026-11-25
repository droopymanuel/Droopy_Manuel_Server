CREATE TABLE "donations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "donations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"external_reference" varchar(255) NOT NULL,
	"payment_id" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"status_detail" varchar(120),
	"stars" integer,
	"amount_cents" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"donor_name" varchar(255),
	"donor_email" varchar(255),
	"payment_method" varchar(60),
	"live_mode" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE INDEX "donations_reference_idx" ON "donations" USING btree ("external_reference");--> statement-breakpoint
CREATE INDEX "donations_status_idx" ON "donations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "donations_email_idx" ON "donations" USING btree ("donor_email");--> statement-breakpoint
CREATE INDEX "donations_created_idx" ON "donations" USING btree ("created_at");