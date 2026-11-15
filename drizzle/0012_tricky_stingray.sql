CREATE TYPE "public"."news_section_kind" AS ENUM('hero', 'chapter', 'closing');--> statement-breakpoint
CREATE TABLE "news_sections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "news_sections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"news_slug" varchar(160) NOT NULL,
	"position" integer NOT NULL,
	"kind" "news_section_kind" NOT NULL,
	"title" varchar(255),
	"body" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Las columnas de `dog_health` ya existen desde 0010/0011; drizzle las repite
-- porque el snapshot quedó desincronizado. No se vuelven a agregar.
ALTER TABLE "news_sections" ADD CONSTRAINT "news_sections_news_slug_news_slug_fk" FOREIGN KEY ("news_slug") REFERENCES "public"."news"("slug") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "news_sections_news_position_unique" ON "news_sections" USING btree ("news_slug","position");--> statement-breakpoint
CREATE INDEX "news_sections_news_idx" ON "news_sections" USING btree ("news_slug");--> statement-breakpoint
-- Backfill: el cuerpo antiguo de cada noticia pasa a una sección `chapter`.
INSERT INTO "news_sections" ("news_slug", "position", "kind", "title", "body")
SELECT "slug", 1, 'chapter', NULL, "body" FROM "news" WHERE cardinality("body") > 0;