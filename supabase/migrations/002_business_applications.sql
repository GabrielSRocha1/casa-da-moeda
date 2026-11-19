-- =============================================================================
--  CASA DA MOEDA MASTER DIGITAL — Solicitações de Parceria (Onboarding B2B)
--  Tabela: public.business_applications
-- =============================================================================
--  Como usar: Supabase → SQL Editor → cole e clique em "Run".
--  Pode ser executado de novo sem duplicar nada. Funciona sozinho ou depois do
--  script principal (casa_da_moeda_master_digital.sql).
--
--  Fluxo:
--    Site (chave anon) ──INSERT──► business_applications   (só inserir; nunca ler)
--    Admin do Dashboard (app_metadata.role = 'admin') ──► lê, acompanha e atualiza status
--
--  Substitui, no site, a criação direta de tokens: o empresário agora envia uma
--  solicitação e a equipe avalia antes de qualquer emissão.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Funções auxiliares (mesmas do script principal; recriadas para rodar sozinho)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), ''), 'null')::jsonb ->> 'role',
    CASE
      WHEN COALESCE(current_setting('role', true), 'none') IN ('none', '') THEN session_user::text
      ELSE current_setting('role', true)
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.caller_role() IN ('service_role', 'postgres', 'supabase_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), ''), 'null')::jsonb -> 'app_metadata' ->> 'role',
    ''
  ) = 'admin';
$$;


-- -----------------------------------------------------------------------------
-- 2. Tabela
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_applications (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol              text        NOT NULL UNIQUE,                 -- PAR-XXXXXXXXXX (derivado do id)

  -- Seção 1: Instituição
  company_name          text        NOT NULL CHECK (char_length(company_name) BETWEEN 3 AND 120),
  company_address       text        NOT NULL CHECK (char_length(company_address) BETWEEN 10 AND 300),
  business_sector       text        NOT NULL CHECK (business_sector IN (
                          'Empresas e Negócios',
                          'Eventos e Festas Sertanejas',
                          'Times de Futebol / Esportes',
                          'Feiras Culturais',
                          'Ajuda Humanitária / ONGs',
                          'Igrejas e Instituições Religiosas',
                          'Clubes Recreativos',
                          'Fraternidades e Lojas',
                          'Outros'
                        )),
  business_sector_other text        CHECK (business_sector_other IS NULL OR char_length(business_sector_other) BETWEEN 3 AND 80),
  company_description   text        NOT NULL CHECK (char_length(company_description) BETWEEN 30 AND 800),

  -- Seção 2: Tomador de decisão
  director_name         text        NOT NULL CHECK (char_length(director_name) BETWEEN 5 AND 120),
  whatsapp              text        NOT NULL CHECK (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),         -- E.164
  alt_phone             text        CHECK (alt_phone IS NULL OR alt_phone ~ '^\+[1-9][0-9]{7,14}$'),
  email                 text        NOT NULL CHECK (char_length(email) <= 254 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),

  -- Seção 3: Disponibilidade
  preferred_days        text[]      NOT NULL CHECK (
                          cardinality(preferred_days) BETWEEN 1 AND 7
                          AND preferred_days <@ ARRAY['SEG','TER','QUA','QUI','SEX','SAB','DOM']::text[]
                        ),
  preferred_periods     text[]      NOT NULL CHECK (
                          cardinality(preferred_periods) BETWEEN 1 AND 3
                          AND preferred_periods <@ ARRAY['MANHA','TARDE','NOITE']::text[]
                        ),
  preferred_time_from   time,
  preferred_time_to     time,
  timezone              text        NOT NULL DEFAULT 'America/Sao_Paulo',

  -- Consentimento (LGPD)
  consent_lgpd          boolean     NOT NULL CHECK (consent_lgpd),
  consent_at            timestamptz NOT NULL DEFAULT now(),

  -- Acompanhamento interno (preenchido pela equipe)
  status                text        NOT NULL DEFAULT 'NEW'
                                    CHECK (status IN ('NEW', 'CONTACTED', 'MEETING_SCHEDULED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  internal_notes        text,
  assigned_to           uuid,                                          -- auth.users.id do responsável interno
  contacted_at          timestamptz,
  meeting_at            timestamptz,

  source                text        NOT NULL DEFAULT 'site' CHECK (char_length(source) <= 40),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_applications_other_sector CHECK (
    (business_sector = 'Outros') = (business_sector_other IS NOT NULL)
  ),
  CONSTRAINT business_applications_time_window CHECK (
    (preferred_time_from IS NULL AND preferred_time_to IS NULL)
    OR (preferred_time_from IS NOT NULL AND preferred_time_to IS NOT NULL AND preferred_time_from < preferred_time_to)
  )
);

COMMENT ON TABLE  public.business_applications IS 'Solicitações de parceria (onboarding B2B) enviadas pelo site. O token só é criado após avaliação da equipe.';
COMMENT ON COLUMN public.business_applications.whatsapp IS 'Formato internacional E.164, ex.: +5511912345678.';
COMMENT ON COLUMN public.business_applications.preferred_days IS 'SEG, TER, QUA, QUI, SEX, SAB, DOM.';
COMMENT ON COLUMN public.business_applications.preferred_periods IS 'MANHA (8h–12h), TARDE (12h–18h), NOITE (18h–21h).';

CREATE INDEX IF NOT EXISTS business_applications_status_idx  ON public.business_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS business_applications_sector_idx  ON public.business_applications (business_sector);
CREATE INDEX IF NOT EXISTS business_applications_email_idx   ON public.business_applications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS business_applications_whats_idx   ON public.business_applications (whatsapp, created_at DESC);


-- -----------------------------------------------------------------------------
-- 3. Triggers
-- -----------------------------------------------------------------------------

-- BEFORE INSERT: normaliza, força campos internos e aplica antispam.
CREATE OR REPLACE FUNCTION public.business_applications_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER                       -- conta solicitações anteriores (invisíveis para o anon)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent integer;
BEGIN
  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.protocol := 'PAR-' || upper(left(replace(NEW.id::text, '-', ''), 10));

  NEW.company_name        := regexp_replace(btrim(NEW.company_name), '\s+', ' ', 'g');
  NEW.company_address     := regexp_replace(btrim(NEW.company_address), '\s+', ' ', 'g');
  NEW.company_description := btrim(NEW.company_description);
  NEW.director_name       := regexp_replace(btrim(NEW.director_name), '\s+', ' ', 'g');
  NEW.email               := lower(btrim(NEW.email));
  NEW.whatsapp            := btrim(NEW.whatsapp);
  NEW.alt_phone           := NULLIF(btrim(COALESCE(NEW.alt_phone, '')), '');
  NEW.business_sector_other := CASE WHEN NEW.business_sector = 'Outros'
                                    THEN NULLIF(btrim(COALESCE(NEW.business_sector_other, '')), '') END;

  -- Dias/períodos sem repetição e em ordem fixa
  NEW.preferred_days := ARRAY(
    SELECT d FROM unnest(ARRAY['SEG','TER','QUA','QUI','SEX','SAB','DOM']) WITH ORDINALITY AS t(d, n)
     WHERE d = ANY (NEW.preferred_days) ORDER BY n);
  NEW.preferred_periods := ARRAY(
    SELECT p FROM unnest(ARRAY['MANHA','TARDE','NOITE']) WITH ORDINALITY AS t(p, n)
     WHERE p = ANY (NEW.preferred_periods) ORDER BY n);

  IF NEW.timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'INVALID_TIMEZONE: fuso horário inválido.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.consent_lgpd IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INVALID_CONSENT: é necessário autorizar o contato (LGPD).' USING ERRCODE = 'check_violation';
  END IF;

  -- Campos controlados pela equipe/sistema
  NEW.status         := 'NEW';
  NEW.internal_notes := NULL;
  NEW.assigned_to    := NULL;
  NEW.contacted_at   := NULL;
  NEW.meeting_at     := NULL;
  NEW.consent_at     := now();
  NEW.created_at     := now();
  NEW.updated_at     := now();
  NEW.source         := COALESCE(NULLIF(left(btrim(NEW.source), 40), ''), 'site');

  -- Antispam: no máximo 3 solicitações por e-mail ou WhatsApp em 24 horas
  SELECT count(*) INTO v_recent
    FROM public.business_applications a
   WHERE (a.email = NEW.email OR a.whatsapp = NEW.whatsapp)
     AND a.created_at > now() - interval '24 hours'
     AND a.id <> NEW.id;
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'TOO_MANY_APPLICATIONS: já recebemos solicitações recentes deste contato.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_applications_before_insert ON public.business_applications;
CREATE TRIGGER trg_business_applications_before_insert
  BEFORE INSERT ON public.business_applications
  FOR EACH ROW EXECUTE FUNCTION public.business_applications_before_insert();

-- BEFORE UPDATE: os dados enviados pelo empresário são imutáveis;
-- a equipe altera apenas o acompanhamento (status, notas, responsável, datas).
CREATE OR REPLACE FUNCTION public.business_applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id                    IS DISTINCT FROM OLD.id
     OR NEW.protocol              IS DISTINCT FROM OLD.protocol
     OR NEW.company_name          IS DISTINCT FROM OLD.company_name
     OR NEW.company_address       IS DISTINCT FROM OLD.company_address
     OR NEW.business_sector       IS DISTINCT FROM OLD.business_sector
     OR NEW.business_sector_other IS DISTINCT FROM OLD.business_sector_other
     OR NEW.company_description   IS DISTINCT FROM OLD.company_description
     OR NEW.director_name         IS DISTINCT FROM OLD.director_name
     OR NEW.whatsapp              IS DISTINCT FROM OLD.whatsapp
     OR NEW.alt_phone             IS DISTINCT FROM OLD.alt_phone
     OR NEW.email                 IS DISTINCT FROM OLD.email
     OR NEW.preferred_days        IS DISTINCT FROM OLD.preferred_days
     OR NEW.preferred_periods     IS DISTINCT FROM OLD.preferred_periods
     OR NEW.preferred_time_from   IS DISTINCT FROM OLD.preferred_time_from
     OR NEW.preferred_time_to     IS DISTINCT FROM OLD.preferred_time_to
     OR NEW.timezone              IS DISTINCT FROM OLD.timezone
     OR NEW.consent_lgpd          IS DISTINCT FROM OLD.consent_lgpd
     OR NEW.consent_at            IS DISTINCT FROM OLD.consent_at
     OR NEW.created_at            IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD: os dados enviados na solicitação não podem ser alterados.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'CONTACTED' AND OLD.status <> 'CONTACTED' AND NEW.contacted_at IS NULL THEN
    NEW.contacted_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_applications_guard_update ON public.business_applications;
CREATE TRIGGER trg_business_applications_guard_update
  BEFORE UPDATE ON public.business_applications
  FOR EACH ROW EXECUTE FUNCTION public.business_applications_guard_update();


-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_applications ENABLE ROW LEVEL SECURITY;

-- PERMISSIVA: qualquer visitante envia a solicitação (somente INSERT).
DROP POLICY IF EXISTS business_applications_public_insert ON public.business_applications;
CREATE POLICY business_applications_public_insert ON public.business_applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'NEW' AND consent_lgpd);

-- Leitura e acompanhamento: apenas administradores do Dashboard.
DROP POLICY IF EXISTS business_applications_admin_read ON public.business_applications;
CREATE POLICY business_applications_admin_read ON public.business_applications
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS business_applications_admin_update ON public.business_applications;
CREATE POLICY business_applications_admin_update ON public.business_applications
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- RESTRITIVA: nenhuma atualização fora de admin/backend, mesmo que surja outra política.
DROP POLICY IF EXISTS business_applications_update_restricted ON public.business_applications;
CREATE POLICY business_applications_update_restricted ON public.business_applications
  AS RESTRICTIVE
  FOR UPDATE TO public
  USING (public.is_admin() OR public.is_service_role())
  WITH CHECK (public.is_admin() OR public.is_service_role());
-- Sem política de DELETE: exclusão só pelo backend (service_role), ex.: pedido de remoção LGPD.


-- -----------------------------------------------------------------------------
-- 5. Privilégios (o Supabase concede ALL por padrão — restringimos)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.business_applications FROM anon, authenticated;
GRANT INSERT ON public.business_applications TO anon, authenticated;
GRANT SELECT ON public.business_applications TO authenticated;                    -- filtrado: só admin
GRANT UPDATE (status, internal_notes, assigned_to, contacted_at, meeting_at)
  ON public.business_applications TO authenticated;                               -- filtrado: só admin
GRANT ALL ON public.business_applications TO service_role;

REVOKE EXECUTE ON FUNCTION public.business_applications_before_insert(),
                           public.business_applications_guard_update()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.caller_role(), public.is_service_role(), public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_role(), public.is_service_role(), public.is_admin()
  TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. View do Dashboard (respeita o RLS de quem consulta)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.dashboard_business_applications
WITH (security_invoker = true) AS
SELECT
  business_sector,
  status,
  count(*)                                              AS applications,
  count(*) FILTER (WHERE created_at > now() - interval '7 days') AS last_7_days,
  max(created_at)                                       AS last_received_at
FROM public.business_applications
GROUP BY business_sector, status;

REVOKE ALL ON public.dashboard_business_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dashboard_business_applications TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. Realtime: novas solicitações aparecem no Dashboard do admin na hora
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'business_applications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.business_applications;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Referência rápida
-- =============================================================================
-- Configurar o site: no <head> do HTML, preencha
--   <meta name="cmmd-supabase-url"      content="https://<projeto>.supabase.co" />
--   <meta name="cmmd-supabase-anon-key" content="<chave anon pública>" />
--
-- Tornar um usuário admin do Dashboard:
--   UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' WHERE email = '<email>';
--
-- Fila de atendimento (admin):
--   SELECT protocol, company_name, business_sector, director_name, whatsapp, preferred_days, preferred_periods, created_at
--     FROM business_applications WHERE status = 'NEW' ORDER BY created_at;
--
-- Marcar como contatado:
--   UPDATE business_applications SET status = 'CONTACTED', internal_notes = 'Reunião marcada' WHERE protocol = 'PAR-XXXXXXXXXX';
