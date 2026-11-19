-- IF NOT EXISTS: em produção (Supabase) a tabela já foi criada pelas migrations
-- 002/003 do diretório supabase/, com triggers e RLS próprios. Em dev (PGlite)
-- este CREATE é quem cria a tabela.
CREATE TABLE IF NOT EXISTS "business_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" text NOT NULL,
	"company_name" text NOT NULL,
	"company_address" text NOT NULL,
	"business_sector" text NOT NULL,
	"business_sector_other" text,
	"company_description" text NOT NULL,
	"director_name" text NOT NULL,
	"whatsapp" text NOT NULL,
	"alt_phone" text,
	"email" text NOT NULL,
	"needs_creation_approver" boolean DEFAULT false NOT NULL,
	"approver_name" text,
	"preferred_days" text[] NOT NULL,
	"preferred_periods" text[] NOT NULL,
	"preferred_time_from" time,
	"preferred_time_to" time,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"consent_lgpd" boolean NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"source" text DEFAULT 'site' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_applications_protocol_unique" UNIQUE("protocol")
);
