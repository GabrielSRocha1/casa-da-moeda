# Pendências para produção

Situação em 09/11/2026. Itens em ordem de prioridade sugerida.

## 1. Decisões e ajustes de conteúdo

- [ ] **Aviso legal: palavra "comprimento".** O texto foi mantido literal, mas o correto é "**comprometimento**" ou "**cumprimento**" da comunidade. Ele aparece em `frontend/index.html` (const `DISCLAIMER`), `backend/src/config/constants.ts` e `supabase/migrations/001_*.sql`. Corrigir nos três.
- [ ] **Nome "Casa da Moeda".** Pode ser confundido com a Casa da Moeda do Brasil, que é uma empresa pública, e isso traz risco de marca e de parecer órgão oficial. Validar com advogado antes do lançamento. O site não usa nenhum símbolo oficial.

## 2. Integrações reais (hoje simuladas)

- [ ] **Pix real.** Trocar o `SimulatedPixProvider` (`backend/src/modules/p2p/payments/payment-provider.ts`) pelo provedor escolhido, implementando a interface `PaymentProvider`.
- [ ] **Webhook com assinatura.** Antes de chamar `update_order_status_from_gateway` (Supabase) ou `PATCH /api/p2p/orders/:id/status` (API), verificar a assinatura do provedor numa Edge Function ou no backend. O banco não consegue fazer essa verificação.
- [ ] **Envio real de tokens.** Trocar o `SimulatedTokenDispatcher` (`backend/src/modules/p2p/custody/token-dispatcher.ts`) por envio SPL Token na Solana (ou EVM), com a hot wallet da tesouraria, limites e monitoramento.
- [ ] **Cotação real.** O `SimulatedPriceFeed` só roda fora de produção. Definir de onde vem o preço de referência.

## 3. Ligar as pontas

- [ ] **Unificar o schema da API com o do Supabase.** Os nomes são diferentes: na API é `business_token_requests` e `sort_order`; no Supabase é `token_requests`, `business_applications` e o status `FAILED`. Escolher um como fonte da verdade. Sugestão: o Supabase, e a API passa a ler e escrever nele.
- [ ] **P2P do site → API/Supabase.** O fluxo de compra do site ainda é a simulação local (`P2P` e `Payment` em `frontend/index.html`). Ligar a `create_p2p_order` / `get_p2p_order` (Supabase) ou a `POST /api/p2p/orders` (API).
- [ ] **Formulário de parceria → Supabase.** Basta preencher as meta tags `cmmd-supabase-url` e `cmmd-supabase-anon-key` e rodar a migration 002.
- [ ] **Tabela `token_requests`.** Não é mais usada pelo site, que agora envia solicitações de parceria. Mantida para o fluxo interno de emissão; remover se não for usar.

## 4. Operação

- [ ] Habilitar o **pg_cron** e agendar `expire_overdue_orders()` (instruções no fim da migration 001).
- [ ] Criar os **usuários admin** do painel (`app_metadata.role = 'admin'`; o comando está nas migrations).
- [ ] **Painel administrativo**: fila de solicitações de parceria, ordens P2P e alertas do `payment_monitor_queue`.
- [ ] Criar o **login de leitura** da ferramenta de monitoramento (papel `payment_monitor`, instruções na migration 001).
- [ ] Definir `CORS_ORIGINS` e um `WEBHOOK_SECRET` forte na API em produção.
- [ ] Hospedagem do site (qualquer hospedagem estática serve: Vercel, Netlify, Cloudflare Pages, Caddy).

## 5. Já validado

- Backend: 64 testes. Supabase: 86 + 37 testes. Site: 56 + 79 testes, em desktop (1366 px) e celular (390 px).
- As migrations foram testadas num PostgreSQL embutido que simula os papéis do Supabase (`anon`, `authenticated`, `service_role`, admin via JWT). **Ainda não foram executadas num projeto Supabase real.**
