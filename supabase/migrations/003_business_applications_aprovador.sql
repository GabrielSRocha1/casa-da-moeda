-- ============================================================
-- 003 — Pergunta "Você precisa de mais alguém para a permissão
--        da criação?" no formulário de parceria B2B.
--
-- O site envia needs_creation_approver como boolean:
--   false = o responsável autoriza a criação sozinho (padrão)
--   true  = a criação depende de outra pessoa aprovar
-- ============================================================

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS needs_creation_approver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_applications.needs_creation_approver IS
  'true = o responsável precisa de mais alguém para aprovar a criação do token; false = decide sozinho.';

-- Quem é a pessoa que autoriza (obrigatório no site quando needs_creation_approver = true).
ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS approver_name text
    CHECK (approver_name IS NULL OR char_length(approver_name) BETWEEN 5 AND 120);

COMMENT ON COLUMN public.business_applications.approver_name IS
  'Nome (e cargo) de quem precisa aprovar a criação do token, quando needs_creation_approver = true.';

-- Coerência: se precisa de aprovador, o nome deve vir preenchido; se não precisa, fica nulo.
ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_approver_coerente;
ALTER TABLE public.business_applications
  ADD CONSTRAINT business_applications_approver_coerente
    CHECK (needs_creation_approver = (approver_name IS NOT NULL));
