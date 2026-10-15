CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"option_of" uuid,
	"revision" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "projects_owner_updated_idx" ON "projects" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_option_of_idx" ON "projects" USING btree ("option_of");