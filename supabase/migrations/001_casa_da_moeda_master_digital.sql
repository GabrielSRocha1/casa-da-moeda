-- =============================================================================
--  CASA DA MOEDA MASTER DIGITAL — Banco de dados Supabase (PostgreSQL 15+)
-- =============================================================================
--  Como usar:
--    1. Supabase → SQL Editor → New query
--    2. Cole este arquivo inteiro e clique em "Run"
--    3. O script é idempotente: pode ser executado de novo sem duplicar nada.
--
--  O que este script cria:
--    • Tabelas: platform_settings, tokens, token_requests, p2p_orders, p2p_order_events
--    • Precificação no próprio banco: o cliente NÃO consegue escolher a quantidade
--      de tokens; o trigger recalcula com a cotação vigente.
--    • Webhook seguro: update_order_status_from_gateway() (apenas service_role).
--    • Máquina de estados da ordem garantida por trigger (nem o backend pula etapas).
--    • RLS em todas as tabelas + políticas permissivas/restritivas.
--    • Views do Dashboard e fila do monitoramento de pagamentos.
--    • Papel somente-leitura "payment_monitor" para a ferramenta de monitoramento.
--    • Realtime para o carrossel/dashboard.
--
--  Papéis do Supabase:
--    anon           → site público (chave anon)
--    authenticated  → usuário logado (admin = app_metadata.role = 'admin')
--    service_role   → backend / Edge Function do webhook (ignora RLS — NUNCA no frontend)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. FUNÇÕES AUXILIARES (usadas nas políticas e triggers)
-- =============================================================================

-- Papel efetivo de quem chamou. Lê o JWT (PostgREST) e, em conexão direta,
-- o papel da sessão. Funciona inclusive dentro de funções SECURITY DEFINER.
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

COMMENT ON FUNCTION public.caller_role() IS 'Papel efetivo de quem chamou (anon, authenticated, service_role, postgres...).';

-- Backend confiável: service_role (chave secreta) ou administrador do banco.
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.caller_role() IN ('service_role', 'postgres', 'supabase_admin');
$$;

-- Administrador do Dashboard: usuário autenticado com app_metadata.role = 'admin'.
-- app_metadata só pode ser alterado pelo servidor (service_role), nunca pelo próprio usuário.
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

-- Validação de formato de endereço público da Verum Wallet:
--   Solana: base58, 32–44 caracteres (exclui System Program)
--   EVM:    0x + 40 hexadecimais (exclui endereço nulo)
-- A validação criptográfica completa (curva Ed25519 / checksum EIP-55) é feita no backend.
CREATE OR REPLACE FUNCTION public.is_valid_wallet(p_address text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_address IS NOT NULL
     AND (
          (p_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND p_address <> '11111111111111111111111111111111')
       OR (p_address ~ '^0x[0-9a-fA-F]{40}$' AND lower(p_address) <> '0x0000000000000000000000000000000000000000')
     );
$$;

-- Categorias B2B: aceita rótulo ("Festas Sertanejas"), código (FESTAS_SERTANEJAS)
-- ou variações sem acento, e devolve sempre o rótulo canônico.
CREATE OR REPLACE FUNCTION public.normalize_business_category(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE regexp_replace(
                translate(lower(btrim(p_category)), 'áàâãäéèêëíìîïóòôõöúùûüç_-', 'aaaaaeeeeiiiiooooouuuuc  '),
                '\s+', ' ', 'g')
    WHEN 'empresas'                    THEN 'Empresas'
    WHEN 'empresa'                     THEN 'Empresas'
    WHEN 'empresas e negocios'         THEN 'Empresas'
    WHEN 'festas sertanejas'           THEN 'Festas Sertanejas'
    WHEN 'festa sertaneja'             THEN 'Festas Sertanejas'
    WHEN 'eventos'                     THEN 'Festas Sertanejas'
    WHEN 'eventos e festas sertanejas' THEN 'Festas Sertanejas'
    WHEN 'futebol'                     THEN 'Futebol'
    WHEN 'esportes'                    THEN 'Futebol'
    WHEN 'times de futebol e esportes' THEN 'Futebol'
    WHEN 'feiras culturais'            THEN 'Feiras Culturais'
    WHEN 'feira cultural'              THEN 'Feiras Culturais'
    WHEN 'ajuda humanitaria'           THEN 'Ajuda Humanitária'
    WHEN 'ong'                         THEN 'Ajuda Humanitária'
    WHEN 'ongs'                        THEN 'Ajuda Humanitária'
    ELSE NULL
  END;
$$;

-- Normas de utilidade: detecta promessa de lucro/rendimento no texto (sem acento, minúsculo).
CREATE OR REPLACE FUNCTION public.violates_utility_terms(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT translate(lower(COALESCE(p_text, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') ~ (
       'lucros? (garantidos?|certos?|assegurados?)|garantia de lucro'
    || '|rendimentos? (garantidos?|fixos?|mensa(l|is)|assegurados?)'
    || '|retorno( financeiro)? (garantido|certo|assegurado)|retorno de [0-9]+ ?%'
    || '|[0-9]+([.,][0-9]+)? ?% ?(ao|por|a cada) ?(dia|semana|mes|ano)'
    || '|\mdividendos?\M|participacao nos lucros|distribuicao de lucros'
    || '|renda passiva|valorizacao (garantida|certa)|vai valorizar'
    || '|investimento (seguro|sem risco|garantido)|sem risco|risco zero'
    || '|(multiplicar|dobrar) (o |seu )?dinheiro|participacao societaria'
  );
$$;

-- Transições válidas da ordem P2P:
--   PENDING → PAID | FAILED | EXPIRED | CANCELLED
--   EXPIRED → PAID        (pagamento confirmado pelo gateway após o vencimento: dinheiro
--                          recebido nunca é ignorado — a ordem segue para envio/análise)
--   PAID    → COMPLETED | FAILED
--   COMPLETED, FAILED, CANCELLED → finais
CREATE OR REPLACE FUNCTION public.p2p_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_from
    WHEN 'PENDING' THEN p_to IN ('PAID', 'FAILED', 'EXPIRED', 'CANCELLED')
    WHEN 'EXPIRED' THEN p_to = 'PAID'
    WHEN 'PAID'    THEN p_to IN ('COMPLETED', 'FAILED')
    ELSE false
  END;
$$;

-- Atualiza updated_at automaticamente.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- 2. CONFIGURAÇÃO DA PLATAFORMA (linha única)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  p2p_fee_bps                    integer       NOT NULL DEFAULT 150   CHECK (p2p_fee_bps BETWEEN 0 AND 5000), -- 150 = 1,5%
  min_fiat_amount                numeric(18,2) NOT NULL DEFAULT 20     CHECK (min_fiat_amount > 0),
  max_fiat_amount                numeric(18,2) NOT NULL DEFAULT 50000  CHECK (max_fiat_amount > 0),
  order_ttl_minutes              integer       NOT NULL DEFAULT 15     CHECK (order_ttl_minutes BETWEEN 1 AND 1440),
  max_pending_orders_per_wallet  integer       NOT NULL DEFAULT 5      CHECK (max_pending_orders_per_wallet BETWEEN 1 AND 100),
  max_pending_requests_per_wallet integer      NOT NULL DEFAULT 3      CHECK (max_pending_requests_per_wallet BETWEEN 1 AND 100),
  updated_at                     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_fiat_range CHECK (min_fiat_amount < max_fiat_amount)
);

COMMENT ON TABLE public.platform_settings IS 'Parâmetros do P2P (taxa, limites, validade da cobrança, antispam).';

INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 3. TOKENS (ativos nativos + utility tokens B2B)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tokens (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text          NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  symbol            text          NOT NULL UNIQUE CHECK (symbol ~ '^[A-Z][A-Z0-9]{1,9}$'),
  type              text          NOT NULL CHECK (type IN ('NATIVE', 'CUSTOM')),
  price             numeric(18,8) NOT NULL CHECK (price > 0),
  -- (8,2) em vez de (5,2): um token que suba mais de 999,99% em 24h estouraria NUMERIC(5,2).
  change_24h        numeric(8,2)  NOT NULL DEFAULT 0.00,
  category          text          CHECK (category IN ('Empresas', 'Festas Sertanejas', 'Futebol', 'Feiras Culturais', 'Ajuda Humanitária')),
  purpose           text,
  creator_wallet    text          CHECK (creator_wallet IS NULL OR public.is_valid_wallet(creator_wallet)),
  -- Colunas de apoio ao frontend/dashboard
  is_active         boolean       NOT NULL DEFAULT true,
  sort_order        integer       NOT NULL DEFAULT 100,
  icon_url          text,
  source_request_id uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  -- Tokens B2B precisam ter categoria, propósito e carteira do criador.
  CONSTRAINT tokens_custom_requires_b2b_fields CHECK (
    type = 'NATIVE' OR (category IS NOT NULL AND purpose IS NOT NULL AND creator_wallet IS NOT NULL)
  )
);

COMMENT ON TABLE  public.tokens IS 'Ativos negociáveis: nativos (Bode, Verum, Escoteiros) e utility tokens B2B aprovados.';
COMMENT ON COLUMN public.tokens.price IS 'Preço de referência em BRL.';
COMMENT ON COLUMN public.tokens.change_24h IS 'Variação percentual em 24h (ex.: 4.20 = +4,20%).';

CREATE INDEX IF NOT EXISTS tokens_type_active_idx ON public.tokens (type, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_tokens_updated_at ON public.tokens;
CREATE TRIGGER trg_tokens_updated_at
  BEFORE UPDATE ON public.tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 4. SOLICITAÇÕES DE EMISSÃO B2B (token_requests)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.token_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_name      text        NOT NULL CHECK (char_length(btrim(token_name)) BETWEEN 3 AND 40),
  symbol          text        NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9]{1,7}$'),
  category        text        NOT NULL CHECK (category IN ('Empresas', 'Festas Sertanejas', 'Futebol', 'Feiras Culturais', 'Ajuda Humanitária')),
  purpose         text        NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 20 AND 600),
  creator_wallet  text        NOT NULL CHECK (public.is_valid_wallet(creator_wallet)),
  status          text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  -- Vínculo às normas de utilidade (gravado automaticamente)
  utility_terms   jsonb       NOT NULL DEFAULT jsonb_build_object(
                    'utilityClass', 'UTILITY_COMMUNITY_EDUCATIONAL',
                    'termsVersion', '2026-11-v1',
                    'isSecurity', false,
                    'profitGuarantee', false,
                    'financialGuarantee', false
                  ),
  -- Análise
  review_note     text,
  reviewed_at     timestamptz,
  token_id        uuid        REFERENCES public.tokens (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.token_requests IS 'Pedidos de criação de utility tokens por empresas, eventos, times, feiras e ONGs.';

-- O mesmo símbolo não pode estar em dois pedidos ativos (rejeitados liberam o símbolo).
CREATE UNIQUE INDEX IF NOT EXISTS token_requests_symbol_active_uq
  ON public.token_requests (symbol) WHERE status <> 'REJECTED';
CREATE INDEX IF NOT EXISTS token_requests_status_idx ON public.token_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS token_requests_creator_idx ON public.token_requests (creator_wallet);

-- Liga tokens → pedido de origem (FK criada aqui porque token_requests vem depois de tokens).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tokens_source_request_fk') THEN
    ALTER TABLE public.tokens
      ADD CONSTRAINT tokens_source_request_fk
      FOREIGN KEY (source_request_id) REFERENCES public.token_requests (id) ON DELETE SET NULL;
  END IF;
END $$;

-- BEFORE INSERT: normaliza, aplica as normas de utilidade e evita símbolos em uso.
CREATE OR REPLACE FUNCTION public.token_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER                      -- precisa ler tokens/pedidos que o anon não enxerga
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg     public.platform_settings%ROWTYPE;
  v_pending integer;
BEGIN
  SELECT * INTO v_cfg FROM public.platform_settings WHERE id = 1;

  NEW.token_name     := btrim(NEW.token_name);
  NEW.symbol         := upper(btrim(NEW.symbol));
  NEW.purpose        := btrim(NEW.purpose);
  NEW.creator_wallet := btrim(NEW.creator_wallet);
  NEW.category       := public.normalize_business_category(NEW.category);
  IF NEW.category IS NULL THEN
    RAISE EXCEPTION 'INVALID_CATEGORY: use Empresas, Festas Sertanejas, Futebol, Feiras Culturais ou Ajuda Humanitária.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Campos controlados pelo sistema (o cliente não define)
  NEW.status      := 'PENDING';
  NEW.review_note := NULL;
  NEW.reviewed_at := NULL;
  NEW.token_id    := NULL;
  NEW.created_at  := now();
  NEW.utility_terms := jsonb_build_object(
    'utilityClass', 'UTILITY_COMMUNITY_EDUCATIONAL',
    'termsVersion', '2026-11-v1',
    'isSecurity', false,
    'profitGuarantee', false,
    'financialGuarantee', false,
    'acceptedAt', now()
  );

  IF public.violates_utility_terms(NEW.token_name || ' ' || NEW.purpose) THEN
    RAISE EXCEPTION 'COMPLIANCE_VIOLATION: utility tokens não podem prometer lucro, rendimento, dividendos ou valorização.'
      USING ERRCODE = 'check_violation',
            HINT = 'Descreva a utilidade do token (ingresso, cashback, fidelidade, votação, doações).';
  END IF;

  IF NEW.symbol IN ('BODE', 'VRM', 'ESC', 'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'DAI',
                    'BRL', 'BRZ', 'USD', 'EUR', 'PYG', 'DREX', 'PIX', 'CMMD')
     OR EXISTS (SELECT 1 FROM public.tokens t WHERE t.symbol = NEW.symbol) THEN
    RAISE EXCEPTION 'SYMBOL_UNAVAILABLE: o símbolo % é reservado ou já está em uso.', NEW.symbol
      USING ERRCODE = 'unique_violation';
  END IF;

  IF lower(NEW.token_name) IN ('bode coin', 'verum coin', 'escoteiros coin') THEN
    RAISE EXCEPTION 'TOKEN_NAME_UNAVAILABLE: este nome pertence a um ativo nativo.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Antispam: limite de pedidos pendentes por carteira
  SELECT count(*) INTO v_pending
    FROM public.token_requests r
   WHERE r.creator_wallet = NEW.creator_wallet AND r.status = 'PENDING';
  IF v_pending >= v_cfg.max_pending_requests_per_wallet THEN
    RAISE EXCEPTION 'TOO_MANY_PENDING_REQUESTS: aguarde a análise dos pedidos anteriores.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_token_requests_before_insert ON public.token_requests;
CREATE TRIGGER trg_token_requests_before_insert
  BEFORE INSERT ON public.token_requests
  FOR EACH ROW EXECUTE FUNCTION public.token_requests_before_insert();

-- BEFORE UPDATE: dados do pedido são imutáveis; status só muda pelas funções de análise.
CREATE OR REPLACE FUNCTION public.token_requests_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.token_name     IS DISTINCT FROM OLD.token_name
     OR NEW.symbol         IS DISTINCT FROM OLD.symbol
     OR NEW.category       IS DISTINCT FROM OLD.category
     OR NEW.purpose        IS DISTINCT FROM OLD.purpose
     OR NEW.creator_wallet IS DISTINCT FROM OLD.creator_wallet
     OR NEW.utility_terms  IS DISTINCT FROM OLD.utility_terms
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD: os dados do pedido não podem ser alterados.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF COALESCE(current_setting('app.status_source', true), '') = '' THEN
      RAISE EXCEPTION 'STATUS_CHANGE_NOT_ALLOWED: use approve_token_request() ou reject_token_request().'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED')) THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_token_requests_guard_update ON public.token_requests;
CREATE TRIGGER trg_token_requests_guard_update
  BEFORE UPDATE ON public.token_requests
  FOR EACH ROW EXECUTE FUNCTION public.token_requests_guard_update();


-- =============================================================================
-- 5. ORDENS P2P (p2p_orders) + TRILHA DE AUDITORIA (p2p_order_events)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.p2p_orders (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol        text          NOT NULL REFERENCES public.tokens (symbol) ON UPDATE CASCADE,
  fiat_amount         numeric(18,2) NOT NULL CHECK (fiat_amount > 0),          -- BRL pago
  token_amount        numeric(18,8) NOT NULL CHECK (token_amount > 0),         -- calculado pelo trigger
  user_wallet_address text          NOT NULL CHECK (public.is_valid_wallet(user_wallet_address)),
  payment_gateway_id  text,                                                    -- ID externo (txid/ID do Pix) — índice único abaixo
  status              text          NOT NULL DEFAULT 'PENDING'
                                    CHECK (status IN ('PENDING', 'PAID', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  expires_at          timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  -- Colunas de apoio (preenchidas pelo sistema)
  unit_price          numeric(18,8),                                           -- cotação travada
  fee_amount          numeric(18,2),                                           -- taxa da plataforma em BRL
  payment_payload     text,                                                    -- Pix copia e cola
  paid_at             timestamptz,
  completed_at        timestamptz,
  custody_tx_hash     text,                                                    -- tx do envio para a Verum Wallet
  failure_reason      text
);

COMMENT ON TABLE  public.p2p_orders IS 'Ordens de compra P2P: Pix → confirmação do gateway → envio para auto-custódia.';
COMMENT ON COLUMN public.p2p_orders.payment_gateway_id IS 'ID da cobrança no gateway/monitor de pagamentos. Chave de busca do webhook.';
COMMENT ON COLUMN public.p2p_orders.status IS 'PENDING, PAID, COMPLETED, FAILED, EXPIRED, CANCELLED (cancelada pelo usuário antes do pagamento).';

-- Índice exigido para o webhook: busca instantânea por payment_gateway_id.
-- Único: o mesmo ID do gateway nunca aponta para duas ordens.
CREATE UNIQUE INDEX IF NOT EXISTS p2p_orders_payment_gateway_id_idx
  ON public.p2p_orders (payment_gateway_id) WHERE payment_gateway_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS p2p_orders_status_created_idx ON public.p2p_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS p2p_orders_pending_expiry_idx ON public.p2p_orders (expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS p2p_orders_wallet_idx ON public.p2p_orders (user_wallet_address, status);
CREATE INDEX IF NOT EXISTS p2p_orders_asset_idx ON public.p2p_orders (asset_symbol, created_at DESC);

-- Trilha de auditoria (append-only): toda mudança de status fica registrada.
CREATE TABLE IF NOT EXISTS public.p2p_order_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          uuid        NOT NULL REFERENCES public.p2p_orders (id) ON DELETE CASCADE,
  from_status       text,
  to_status         text        NOT NULL,
  source            text        NOT NULL CHECK (source IN ('api', 'gateway', 'system', 'user', 'admin')),
  gateway_event_id  text,                                                       -- idempotência do webhook
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.p2p_order_events IS 'Histórico imutável de status das ordens (inclui eventos do gateway).';

CREATE INDEX IF NOT EXISTS p2p_order_events_order_idx ON public.p2p_order_events (order_id, created_at);
-- O mesmo evento do gateway nunca é processado duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS p2p_order_events_gateway_event_uq
  ON public.p2p_order_events (gateway_event_id) WHERE gateway_event_id IS NOT NULL;

-- Eventos são somente-inserção: bloqueia UPDATE/DELETE até para o backend.
CREATE OR REPLACE FUNCTION public.p2p_order_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: a trilha de auditoria não pode ser alterada.' USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_order_events_append_only ON public.p2p_order_events;
CREATE TRIGGER trg_p2p_order_events_append_only
  BEFORE UPDATE OR DELETE ON public.p2p_order_events
  FOR EACH ROW EXECUTE FUNCTION public.p2p_order_events_append_only();

-- BEFORE INSERT: o BANCO calcula taxa e quantidade de tokens (o cliente não decide).
CREATE OR REPLACE FUNCTION public.p2p_orders_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER                      -- lê tokens/config e conta ordens pendentes (invisíveis ao anon)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg     public.platform_settings%ROWTYPE;
  v_token   public.tokens%ROWTYPE;
  v_fee     numeric(18,2);
  v_pending integer;
BEGIN
  SELECT * INTO v_cfg FROM public.platform_settings WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_MISSING: platform_settings não configurada.';
  END IF;

  NEW.asset_symbol        := upper(btrim(NEW.asset_symbol));
  NEW.user_wallet_address := btrim(NEW.user_wallet_address);

  SELECT * INTO v_token FROM public.tokens WHERE symbol = NEW.asset_symbol;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_NOT_FOUND: token % não encontrado.', NEW.asset_symbol USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT v_token.is_active THEN
    RAISE EXCEPTION 'TOKEN_NOT_TRADABLE: token % indisponível para compra.', NEW.asset_symbol USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.fiat_amount IS NULL OR NEW.fiat_amount < v_cfg.min_fiat_amount OR NEW.fiat_amount > v_cfg.max_fiat_amount THEN
    RAISE EXCEPTION 'FIAT_AMOUNT_OUT_OF_RANGE: o valor deve estar entre R$ % e R$ %.', v_cfg.min_fiat_amount, v_cfg.max_fiat_amount
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.is_valid_wallet(NEW.user_wallet_address) THEN
    RAISE EXCEPTION 'WALLET_INVALID: informe o endereço público da sua Verum Wallet (Solana ou EVM 0x…).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Antispam: limite de ordens pendentes por carteira
  SELECT count(*) INTO v_pending
    FROM public.p2p_orders o
   WHERE o.user_wallet_address = NEW.user_wallet_address
     AND o.status = 'PENDING'
     AND o.expires_at > now();
  IF v_pending >= v_cfg.max_pending_orders_per_wallet THEN
    RAISE EXCEPTION 'TOO_MANY_PENDING_ORDERS: conclua ou cancele as ordens pendentes desta carteira.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Precificação: taxa arredondada ao centavo; quantidade truncada (nunca envia a mais)
  v_fee            := round(NEW.fiat_amount * v_cfg.p2p_fee_bps / 10000.0, 2);
  NEW.fee_amount   := v_fee;
  NEW.unit_price   := v_token.price;
  NEW.token_amount := trunc((NEW.fiat_amount - v_fee) / v_token.price, 8);
  IF NEW.token_amount <= 0 THEN
    RAISE EXCEPTION 'TOKEN_AMOUNT_TOO_SMALL: valor insuficiente.' USING ERRCODE = 'check_violation';
  END IF;

  -- Campos controlados pelo sistema
  NEW.status          := 'PENDING';
  NEW.expires_at      := now() + make_interval(mins => v_cfg.order_ttl_minutes);
  NEW.created_at      := now();
  NEW.updated_at      := now();
  NEW.paid_at         := NULL;
  NEW.completed_at    := NULL;
  NEW.custody_tx_hash := NULL;
  NEW.failure_reason  := NULL;

  -- Somente o backend pode já criar a ordem vinculada à cobrança do gateway.
  IF NOT public.is_service_role() THEN
    NEW.payment_gateway_id := NULL;
    NEW.payment_payload    := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_orders_before_insert ON public.p2p_orders;
CREATE TRIGGER trg_p2p_orders_before_insert
  BEFORE INSERT ON public.p2p_orders
  FOR EACH ROW EXECUTE FUNCTION public.p2p_orders_before_insert();

-- AFTER INSERT: registra a criação na trilha de auditoria.
CREATE OR REPLACE FUNCTION public.p2p_orders_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.p2p_order_events (order_id, from_status, to_status, source, note)
  VALUES (NEW.id, NULL, NEW.status, 'api', 'Ordem criada');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_orders_after_insert ON public.p2p_orders;
CREATE TRIGGER trg_p2p_orders_after_insert
  AFTER INSERT ON public.p2p_orders
  FOR EACH ROW EXECUTE FUNCTION public.p2p_orders_after_insert();

-- BEFORE UPDATE: protege valores financeiros e impõe a máquina de estados.
-- Vale para TODOS os papéis, inclusive service_role.
CREATE OR REPLACE FUNCTION public.p2p_orders_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.asset_symbol        IS DISTINCT FROM OLD.asset_symbol
     OR NEW.fiat_amount         IS DISTINCT FROM OLD.fiat_amount
     OR NEW.token_amount        IS DISTINCT FROM OLD.token_amount
     OR NEW.unit_price          IS DISTINCT FROM OLD.unit_price
     OR NEW.fee_amount          IS DISTINCT FROM OLD.fee_amount
     OR NEW.user_wallet_address IS DISTINCT FROM OLD.user_wallet_address
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD: valores, cotação e carteira de destino não podem ser alterados.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- payment_gateway_id é gravado uma única vez
  IF OLD.payment_gateway_id IS NOT NULL AND NEW.payment_gateway_id IS DISTINCT FROM OLD.payment_gateway_id THEN
    RAISE EXCEPTION 'GATEWAY_ID_LOCKED: payment_gateway_id já definido para esta ordem.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Mudança de status só pelas funções oficiais (que também gravam a auditoria)
    IF COALESCE(current_setting('app.status_source', true), '') = '' THEN
      RAISE EXCEPTION 'STATUS_CHANGE_NOT_ALLOWED: use update_order_status_from_gateway(), cancel_p2p_order() ou expire_overdue_orders().'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.p2p_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % → % não é permitido.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_orders_guard_update ON public.p2p_orders;
CREATE TRIGGER trg_p2p_orders_guard_update
  BEFORE UPDATE ON public.p2p_orders
  FOR EACH ROW EXECUTE FUNCTION public.p2p_orders_guard_update();


-- =============================================================================
-- 6. INTEGRAÇÃO COM O GATEWAY / MONITORAMENTO DE PAGAMENTOS
-- =============================================================================

-- 6.1 Vincula a cobrança do gateway à ordem (backend, logo após criar o Pix no gateway).
CREATE OR REPLACE FUNCTION public.set_order_payment_charge(
  p_order_id           uuid,
  p_payment_gateway_id text,
  p_payment_payload    text DEFAULT NULL,
  p_expires_at         timestamptz DEFAULT NULL
)
RETURNS public.p2p_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_payment_gateway_id), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: payment_gateway_id é obrigatório.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_order FROM public.p2p_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: ordem % não encontrada.', p_order_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_order.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ORDER_NOT_PENDING: a ordem está %.', v_order.status USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.p2p_orders
     SET payment_gateway_id = btrim(p_payment_gateway_id),
         payment_payload    = COALESCE(p_payment_payload, payment_payload),
         expires_at         = COALESCE(p_expires_at, expires_at)
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

COMMENT ON FUNCTION public.set_order_payment_charge(uuid, text, text, timestamptz) IS
  'Backend: grava o ID externo e o Pix copia e cola da cobrança criada no gateway.';

-- 6.2 WEBHOOK: atualiza o status da ordem a partir da confirmação do gateway.
--
--  Chamado pela Edge Function / backend APÓS verificar a assinatura do webhook
--  (ex.: HMAC/RSA do provedor). O banco não confia em ninguém além do service_role.
--
--  Garantias:
--   • Busca indexada por payment_gateway_id + trava da linha (FOR UPDATE):
--     webhooks simultâneos nunca processam a mesma ordem em paralelo.
--   • Idempotente: o mesmo gateway_event_id ou o mesmo status → nenhuma alteração.
--   • Máquina de estados respeitada; COMPLETED exige o hash da transação on-chain.
--   • Tudo registrado em p2p_order_events (com o payload bruto do gateway).
--
--  Retorno (jsonb): { result: 'updated'|'unchanged'|'duplicate_event', order_id, status, previous_status }
CREATE OR REPLACE FUNCTION public.update_order_status_from_gateway(
  p_payment_gateway_id text,
  p_new_status         text,
  p_gateway_event_id   text  DEFAULT NULL,
  p_payload            jsonb DEFAULT '{}'::jsonb,
  p_custody_tx_hash    text  DEFAULT NULL,
  p_failure_reason     text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   text := upper(btrim(COALESCE(p_new_status, '')));
  v_order    public.p2p_orders%ROWTYPE;
  v_previous text;
  v_note     text;
BEGIN
  IF COALESCE(btrim(p_payment_gateway_id), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_payment_gateway_id é obrigatório.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_status NOT IN ('PAID', 'COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'INVALID_INPUT: status deve ser PAID, COMPLETED ou FAILED (recebido: %).', p_new_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Localiza e TRAVA a ordem (usa o índice de payment_gateway_id)
  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE payment_gateway_id = btrim(p_payment_gateway_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: nenhuma ordem com payment_gateway_id %.', p_payment_gateway_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Evento já processado (reentrega do webhook)
  IF p_gateway_event_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.p2p_order_events WHERE gateway_event_id = p_gateway_event_id) THEN
    RETURN jsonb_build_object('result', 'duplicate_event', 'order_id', v_order.id, 'status', v_order.status);
  END IF;

  -- Mesmo status: sucesso idempotente
  IF v_order.status = v_status THEN
    RETURN jsonb_build_object('result', 'unchanged', 'order_id', v_order.id, 'status', v_order.status);
  END IF;

  IF NOT public.p2p_transition_allowed(v_order.status, v_status) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % → % não é permitido para a ordem %.', v_order.status, v_status, v_order.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status = 'COMPLETED' AND COALESCE(btrim(p_custody_tx_hash), '') = '' THEN
    RAISE EXCEPTION 'CUSTODY_TX_REQUIRED: informe p_custody_tx_hash (envio para a Verum Wallet).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_previous := v_order.status;
  v_note := CASE v_status
    WHEN 'PAID'      THEN CASE WHEN v_previous = 'EXPIRED'
                               THEN 'Pagamento confirmado APÓS o vencimento — revisar antes do envio'
                               ELSE 'Pagamento confirmado pelo gateway' END
    WHEN 'COMPLETED' THEN 'Tokens enviados para a Verum Wallet'
    WHEN 'FAILED'    THEN COALESCE(p_failure_reason, 'Falha informada pelo gateway')
  END;

  PERFORM set_config('app.status_source', 'gateway', true);

  UPDATE public.p2p_orders
     SET status          = v_status,
         paid_at         = CASE WHEN v_status = 'PAID' THEN now() ELSE paid_at END,
         completed_at    = CASE WHEN v_status = 'COMPLETED' THEN now() ELSE completed_at END,
         custody_tx_hash = CASE WHEN v_status = 'COMPLETED' THEN btrim(p_custody_tx_hash) ELSE custody_tx_hash END,
         failure_reason  = CASE WHEN v_status = 'FAILED' THEN COALESCE(p_failure_reason, 'Falha informada pelo gateway') ELSE failure_reason END
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.p2p_order_events (order_id, from_status, to_status, source, gateway_event_id, payload, note)
  VALUES (v_order.id, v_previous, v_status, 'gateway', p_gateway_event_id, COALESCE(p_payload, '{}'::jsonb), v_note);

  PERFORM set_config('app.status_source', '', true);

  RETURN jsonb_build_object(
    'result', 'updated',
    'order_id', v_order.id,
    'previous_status', v_previous,
    'status', v_order.status,
    'late_payment', (v_previous = 'EXPIRED')
  );
END;
$$;

COMMENT ON FUNCTION public.update_order_status_from_gateway(text, text, text, jsonb, text, text) IS
  'Webhook do gateway/monitor de pagamentos. Somente service_role. Idempotente e auditado.';

-- 6.3 Cancelamento pelo próprio comprador (somente PENDING). O UUID da ordem funciona como credencial.
CREATE OR REPLACE FUNCTION public.cancel_p2p_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.p2p_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: ordem não encontrada.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_order.status = 'CANCELLED' THEN
    RETURN public.get_p2p_order(p_order_id);
  END IF;
  IF v_order.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE: a ordem está % e não pode ser cancelada.', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.status_source', 'user', true);
  UPDATE public.p2p_orders SET status = 'CANCELLED' WHERE id = p_order_id;
  INSERT INTO public.p2p_order_events (order_id, from_status, to_status, source, note)
  VALUES (p_order_id, 'PENDING', 'CANCELLED', 'user', 'Cancelada pelo comprador');
  PERFORM set_config('app.status_source', '', true);

  RETURN public.get_p2p_order(p_order_id);
END;
$$;

-- 6.4 Expira cobranças vencidas (rodar via pg_cron a cada minuto — ver seção 11).
CREATE OR REPLACE FUNCTION public.expire_overdue_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config('app.status_source', 'system', true);

  WITH expired AS (
    UPDATE public.p2p_orders
       SET status = 'EXPIRED'
     WHERE status = 'PENDING'
       AND expires_at <= now()
    RETURNING id
  ), logged AS (
    INSERT INTO public.p2p_order_events (order_id, from_status, to_status, source, note)
    SELECT id, 'PENDING', 'EXPIRED', 'system', 'Cobrança Pix expirou sem pagamento' FROM expired
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM logged;

  PERFORM set_config('app.status_source', '', true);
  RETURN v_count;
END;
$$;


-- =============================================================================
-- 7. API PÚBLICA SEGURA (RPC) PARA O SITE
-- =============================================================================

-- Consulta da ordem pelo comprador (dados não sensíveis; carteira mascarada).
CREATE OR REPLACE FUNCTION public.get_p2p_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o public.p2p_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.p2p_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: ordem não encontrada.' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'id', o.id,
    'asset_symbol', o.asset_symbol,
    'fiat_amount', o.fiat_amount,
    'fee_amount', o.fee_amount,
    'unit_price', o.unit_price,
    'token_amount', o.token_amount,
    'wallet', left(o.user_wallet_address, 6) || '…' || right(o.user_wallet_address, 4),
    -- Ordem vencida aparece como EXPIRED mesmo antes do pg_cron rodar
    'status', CASE WHEN o.status = 'PENDING' AND o.expires_at <= now() THEN 'EXPIRED' ELSE o.status END,
    'expires_at', o.expires_at,
    'payment_ready', o.payment_gateway_id IS NOT NULL,
    'payment_payload', CASE WHEN o.status = 'PENDING' AND o.expires_at > now() THEN o.payment_payload END,
    'custody_tx_hash', o.custody_tx_hash,
    'created_at', o.created_at,
    'updated_at', o.updated_at
  );
END;
$$;

-- Criação de ordem pelo site em uma chamada (alternativa ao INSERT direto).
-- Recomendado: devolve a ordem calculada sem precisar de permissão de SELECT na tabela.
CREATE OR REPLACE FUNCTION public.create_p2p_order(
  p_asset_symbol        text,
  p_fiat_amount         numeric,
  p_user_wallet_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_fiat_amount IS NULL OR p_fiat_amount <> round(p_fiat_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_INPUT: valor em BRL com no máximo 2 casas decimais.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- token_amount é recalculado pelo trigger; o valor abaixo é apenas um marcador.
  INSERT INTO public.p2p_orders (asset_symbol, fiat_amount, token_amount, user_wallet_address)
  VALUES (p_asset_symbol, p_fiat_amount, 1, p_user_wallet_address)
  RETURNING id INTO v_id;
  RETURN public.get_p2p_order(v_id);
END;
$$;


-- =============================================================================
-- 8. ANÁLISE DE PEDIDOS B2B (admin do Dashboard ou backend)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.approve_token_request(p_request_id uuid, p_initial_price numeric)
RETURNS public.tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.token_requests%ROWTYPE;
  t public.tokens%ROWTYPE;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: apenas administradores.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_initial_price IS NULL OR p_initial_price <= 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: preço inicial deve ser maior que zero.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO r FROM public.token_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: pedido não encontrado.' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status <> 'PENDING' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING: pedido já está %.', r.status USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tokens (name, symbol, type, price, change_24h, category, purpose, creator_wallet, source_request_id)
  VALUES (r.token_name, r.symbol, 'CUSTOM', p_initial_price, 0, r.category, r.purpose, r.creator_wallet, r.id)
  RETURNING * INTO t;

  PERFORM set_config('app.status_source', 'admin', true);
  UPDATE public.token_requests
     SET status = 'APPROVED', reviewed_at = now(), token_id = t.id, review_note = 'Aprovado'
   WHERE id = r.id;
  PERFORM set_config('app.status_source', '', true);

  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_token_request(p_request_id uuid, p_reason text)
RETURNS public.token_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.token_requests%ROWTYPE;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: apenas administradores.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: informe o motivo da rejeição.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.status_source', 'admin', true);
  UPDATE public.token_requests
     SET status = 'REJECTED', reviewed_at = now(), review_note = btrim(p_reason)
   WHERE id = p_request_id AND status = 'PENDING'
  RETURNING * INTO r;
  PERFORM set_config('app.status_source', '', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING: pedido inexistente ou já analisado.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN r;
END;
$$;


-- =============================================================================
-- 9. ROW LEVEL SECURITY (RLS) + POLÍTICAS
-- =============================================================================
-- Lembrete: service_role IGNORA RLS no Supabase. Por isso as regras críticas
-- (preço, imutabilidade, máquina de estados) também estão nos triggers acima.

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_order_events  ENABLE ROW LEVEL SECURITY;

-- Papel somente-leitura para a ferramenta de monitoramento (criado antes das políticas que o citam)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_monitor') THEN
    CREATE ROLE payment_monitor NOLOGIN NOINHERIT;
  END IF;
END $$;
COMMENT ON ROLE payment_monitor IS 'Leitura de ordens, eventos e views do dashboard. Sem escrita e sem executar o webhook.';

-- ---------- platform_settings: leitura pública (o site mostra taxa e limites)
DROP POLICY IF EXISTS platform_settings_public_read ON public.platform_settings;
CREATE POLICY platform_settings_public_read ON public.platform_settings
  FOR SELECT TO anon, authenticated, payment_monitor
  USING (true);

-- ---------- tokens: leitura pública (carrossel + dashboard em tempo real)
DROP POLICY IF EXISTS tokens_public_read ON public.tokens;
CREATE POLICY tokens_public_read ON public.tokens
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS tokens_monitor_read ON public.tokens;
CREATE POLICY tokens_monitor_read ON public.tokens
  FOR SELECT TO payment_monitor
  USING (true);
-- Sem políticas de INSERT/UPDATE/DELETE: apenas o backend (service_role) altera tokens.

-- ---------- p2p_orders
-- PERMISSIVA: qualquer visitante pode criar ordem. O trigger força preço, status e validade.
DROP POLICY IF EXISTS p2p_orders_public_insert ON public.p2p_orders;
CREATE POLICY p2p_orders_public_insert ON public.p2p_orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'PENDING'
    AND payment_gateway_id IS NULL
    AND public.is_valid_wallet(user_wallet_address)
  );

-- Leitura completa apenas para admins do Dashboard (o comprador usa get_p2p_order()).
DROP POLICY IF EXISTS p2p_orders_admin_read ON public.p2p_orders;
CREATE POLICY p2p_orders_admin_read ON public.p2p_orders
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS p2p_orders_monitor_read ON public.p2p_orders;
CREATE POLICY p2p_orders_monitor_read ON public.p2p_orders
  FOR SELECT TO payment_monitor
  USING (true);

-- RESTRITIVA: atualização de status/pagamento somente pelo backend autenticado.
-- Políticas RESTRICTIVE são combinadas com AND: mesmo que alguém crie no futuro uma
-- política permissiva de UPDATE por engano, esta continua bloqueando quem não é backend.
DROP POLICY IF EXISTS p2p_orders_update_backend_only ON public.p2p_orders;
CREATE POLICY p2p_orders_update_backend_only ON public.p2p_orders
  AS RESTRICTIVE
  FOR UPDATE TO public
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());

DROP POLICY IF EXISTS p2p_orders_delete_never ON public.p2p_orders;
CREATE POLICY p2p_orders_delete_never ON public.p2p_orders
  AS RESTRICTIVE
  FOR DELETE TO public
  USING (public.is_service_role());

-- ---------- p2p_order_events: leitura para admin e monitor; escrita só pelas funções
DROP POLICY IF EXISTS p2p_order_events_admin_read ON public.p2p_order_events;
CREATE POLICY p2p_order_events_admin_read ON public.p2p_order_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS p2p_order_events_monitor_read ON public.p2p_order_events;
CREATE POLICY p2p_order_events_monitor_read ON public.p2p_order_events
  FOR SELECT TO payment_monitor
  USING (true);

-- ---------- token_requests
-- PERMISSIVA: empresários enviam pedidos pelo site. O trigger aplica as normas de utilidade.
DROP POLICY IF EXISTS token_requests_public_insert ON public.token_requests;
CREATE POLICY token_requests_public_insert ON public.token_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'PENDING' AND public.is_valid_wallet(creator_wallet));

DROP POLICY IF EXISTS token_requests_admin_read ON public.token_requests;
CREATE POLICY token_requests_admin_read ON public.token_requests
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS token_requests_monitor_read ON public.token_requests;
CREATE POLICY token_requests_monitor_read ON public.token_requests
  FOR SELECT TO payment_monitor
  USING (true);

DROP POLICY IF EXISTS token_requests_update_backend_only ON public.token_requests;
CREATE POLICY token_requests_update_backend_only ON public.token_requests
  AS RESTRICTIVE
  FOR UPDATE TO public
  USING (public.is_service_role())
  WITH CHECK (public.is_service_role());


-- =============================================================================
-- 10. PRIVILÉGIOS (defesa em profundidade — o Supabase concede ALL por padrão)
-- =============================================================================

-- Tabelas
REVOKE ALL ON public.platform_settings, public.tokens, public.token_requests,
              public.p2p_orders, public.p2p_order_events
  FROM anon, authenticated;

GRANT SELECT          ON public.platform_settings TO anon, authenticated;
GRANT SELECT          ON public.tokens            TO anon, authenticated;
GRANT INSERT          ON public.p2p_orders        TO anon, authenticated;
GRANT SELECT          ON public.p2p_orders        TO authenticated;          -- filtrado: só admin
GRANT INSERT          ON public.token_requests    TO anon, authenticated;
GRANT SELECT          ON public.token_requests    TO authenticated;          -- filtrado: só admin
GRANT SELECT          ON public.p2p_order_events  TO authenticated;          -- filtrado: só admin

GRANT ALL ON public.platform_settings, public.tokens, public.token_requests,
             public.p2p_orders, public.p2p_order_events
  TO service_role;

GRANT USAGE ON SCHEMA public TO payment_monitor;
GRANT SELECT ON public.platform_settings, public.tokens, public.token_requests,
                public.p2p_orders, public.p2p_order_events
  TO payment_monitor;

-- Funções: começa revogando tudo de todos e libera só o necessário
REVOKE EXECUTE ON FUNCTION
  public.caller_role(), public.is_service_role(), public.is_admin(), public.is_valid_wallet(text),
  public.normalize_business_category(text), public.violates_utility_terms(text),
  public.p2p_transition_allowed(text, text), public.set_updated_at(),
  public.token_requests_before_insert(), public.token_requests_guard_update(),
  public.p2p_order_events_append_only(), public.p2p_orders_before_insert(),
  public.p2p_orders_after_insert(), public.p2p_orders_guard_update(),
  public.set_order_payment_charge(uuid, text, text, timestamptz),
  public.update_order_status_from_gateway(text, text, text, jsonb, text, text),
  public.cancel_p2p_order(uuid), public.expire_overdue_orders(), public.get_p2p_order(uuid),
  public.create_p2p_order(text, numeric, text),
  public.approve_token_request(uuid, numeric), public.reject_token_request(uuid, text)
FROM PUBLIC, anon, authenticated;

-- Auxiliares usadas dentro das políticas RLS (avaliadas com o papel de quem consulta)
GRANT EXECUTE ON FUNCTION public.caller_role(), public.is_service_role(), public.is_admin(),
                          public.is_valid_wallet(text), public.normalize_business_category(text),
                          public.p2p_transition_allowed(text, text)
  TO anon, authenticated, service_role, payment_monitor;

-- API pública do site
GRANT EXECUTE ON FUNCTION public.create_p2p_order(text, numeric, text),
                          public.get_p2p_order(uuid),
                          public.cancel_p2p_order(uuid)
  TO anon, authenticated, service_role;

-- Análise B2B: admin do dashboard (verificado dentro da função) e backend
GRANT EXECUTE ON FUNCTION public.approve_token_request(uuid, numeric),
                          public.reject_token_request(uuid, text)
  TO authenticated, service_role;

-- Webhook e rotinas do backend: SOMENTE service_role
GRANT EXECUTE ON FUNCTION public.update_order_status_from_gateway(text, text, text, jsonb, text, text),
                          public.set_order_payment_charge(uuid, text, text, timestamptz),
                          public.expire_overdue_orders()
  TO service_role;


-- =============================================================================
-- 11. VIEWS DO DASHBOARD E DO MONITORAMENTO
-- =============================================================================
-- security_invoker = true: a view respeita o RLS de quem consulta
-- (anon não vê nada; admin e payment_monitor veem tudo).

CREATE OR REPLACE VIEW public.dashboard_order_summary
WITH (security_invoker = true) AS
SELECT
  o.status,
  count(*)                              AS orders,
  COALESCE(sum(o.fiat_amount), 0)       AS fiat_total_brl,
  COALESCE(sum(o.fee_amount), 0)        AS fee_total_brl,
  COALESCE(sum(o.token_amount), 0)      AS token_total,
  max(o.updated_at)                     AS last_update
FROM public.p2p_orders o
GROUP BY o.status;

CREATE OR REPLACE VIEW public.dashboard_daily_volume
WITH (security_invoker = true) AS
SELECT
  (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  o.asset_symbol,
  count(*)                                             AS paid_orders,
  sum(o.fiat_amount)                                   AS fiat_volume_brl,
  sum(o.fee_amount)                                    AS fee_revenue_brl,
  sum(o.token_amount)                                  AS token_volume
FROM public.p2p_orders o
WHERE o.status IN ('PAID', 'COMPLETED')
GROUP BY 1, 2;

-- Fila operacional do monitoramento de pagamentos
CREATE OR REPLACE VIEW public.payment_monitor_queue
WITH (security_invoker = true) AS
SELECT
  o.id,
  o.asset_symbol,
  o.fiat_amount,
  o.token_amount,
  o.payment_gateway_id,
  o.status,
  o.created_at,
  o.expires_at,
  o.paid_at,
  GREATEST(0, EXTRACT(EPOCH FROM (o.expires_at - now())))::integer AS seconds_to_expire,
  CASE
    WHEN o.status = 'PENDING' AND o.payment_gateway_id IS NULL AND o.created_at < now() - interval '2 minutes'
      THEN 'SEM_COBRANCA'               -- ordem criada mas o Pix não foi gerado no gateway
    WHEN o.status = 'PENDING' AND o.expires_at <= now()
      THEN 'VENCIDA_NAO_EXPIRADA'       -- pg_cron não rodou
    WHEN o.status = 'PENDING' AND o.expires_at <= now() + interval '3 minutes'
      THEN 'EXPIRANDO'
    WHEN o.status = 'PENDING'
      THEN 'AGUARDANDO_PAGAMENTO'
    WHEN o.status = 'PAID' AND o.paid_at < now() - interval '10 minutes'
      THEN 'PAGO_SEM_ENVIO'             -- pago há mais de 10 min e tokens não enviados
    WHEN o.status = 'PAID'
      THEN 'AGUARDANDO_ENVIO'
  END AS alert
FROM public.p2p_orders o
WHERE o.status IN ('PENDING', 'PAID');

REVOKE ALL ON public.dashboard_order_summary, public.dashboard_daily_volume, public.payment_monitor_queue
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dashboard_order_summary, public.dashboard_daily_volume, public.payment_monitor_queue
  TO authenticated, service_role, payment_monitor;


-- =============================================================================
-- 12. REALTIME (carrossel e dashboard atualizam sozinhos)
-- =============================================================================
-- O Realtime respeita o RLS: o público recebe só mudanças de `tokens`;
-- ordens e pedidos chegam apenas para admins logados.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['tokens', 'p2p_orders', 'token_requests'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;


-- =============================================================================
-- 13. DADOS INICIAIS — ATIVOS NATIVOS
-- =============================================================================
INSERT INTO public.tokens (name, symbol, type, price, change_24h, purpose, sort_order, icon_url)
VALUES
  ('Bode Coin',       'BODE', 'NATIVE', 0.85000000,  4.20,
   'O token da resistência e da força do sertão. Usado em feiras, eventos e no comércio da comunidade.', 1, '/assets/tokens/bode.svg'),
  ('Verum Coin',      'VRM',  'NATIVE', 3.40000000,  1.80,
   'Token de utilidade do ecossistema Verum: acesso a serviços, descontos e governança comunitária.', 2, '/assets/tokens/verum.svg'),
  ('Escoteiros Coin', 'ESC',  'NATIVE', 0.52000000, -2.10,
   'Recompensa atividades educativas, ações sociais e projetos de grupos de jovens e voluntários.', 3, '/assets/tokens/escoteiros.svg')
ON CONFLICT (symbol) DO NOTHING;

COMMIT;


-- =============================================================================
-- 14. (OPCIONAL) EXPIRAÇÃO AUTOMÁTICA COM pg_cron
-- =============================================================================
-- 1) Database → Extensions → habilite "pg_cron"
-- 2) Execute:
--
--   SELECT cron.schedule('cmmd-expire-orders', '* * * * *', $$SELECT public.expire_overdue_orders()$$);
--
-- Para remover:  SELECT cron.unschedule('cmmd-expire-orders');


-- =============================================================================
-- 15. (OPCIONAL) LOGIN DA FERRAMENTA DE MONITORAMENTO (somente leitura)
-- =============================================================================
-- Gere uma senha forte e execute separadamente (não versione a senha):
--
--   CREATE ROLE monitor_login LOGIN PASSWORD '<senha-forte>' IN ROLE payment_monitor;
--   ALTER ROLE monitor_login SET role = 'payment_monitor';
--
-- Conexão (Supavisor/pooler): usuário "monitor_login.<project-ref>".
-- Esse usuário só lê ordens, eventos e as views; não executa o webhook nem altera dados.


-- =============================================================================
-- 16. COMO CHAMAR (referência rápida)
-- =============================================================================
-- Site (chave anon) — criar ordem:
--   supabase.rpc('create_p2p_order', { p_asset_symbol: 'BODE', p_fiat_amount: 150, p_user_wallet_address: '<wallet>' })
--
-- Site — acompanhar ordem / cancelar:
--   supabase.rpc('get_p2p_order', { p_order_id: '<uuid>' })
--   supabase.rpc('cancel_p2p_order', { p_order_id: '<uuid>' })
--
-- Backend (service_role) — após criar a cobrança Pix no gateway:
--   supabase.rpc('set_order_payment_charge', { p_order_id, p_payment_gateway_id: 'pix_123', p_payment_payload: '000201…' })
--
-- Webhook (Edge Function com service_role, DEPOIS de validar a assinatura do provedor):
--   supabase.rpc('update_order_status_from_gateway', {
--     p_payment_gateway_id: 'pix_123', p_new_status: 'PAID',
--     p_gateway_event_id: 'evt_abc', p_payload: <corpo do webhook>
--   })
--   …e depois do envio on-chain:
--   supabase.rpc('update_order_status_from_gateway', {
--     p_payment_gateway_id: 'pix_123', p_new_status: 'COMPLETED', p_custody_tx_hash: '<assinatura>'
--   })
--
-- Dashboard (admin logado): SELECT em dashboard_order_summary, dashboard_daily_volume,
--   payment_monitor_queue; aprovar pedido: supabase.rpc('approve_token_request', { p_request_id, p_initial_price: 0.10 })
--
-- Tornar um usuário admin (rodar no SQL Editor):
--   UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' WHERE email = '<email>';
