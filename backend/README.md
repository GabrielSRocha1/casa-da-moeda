# Casa da Moeda Master Digital — Backend

API REST da plataforma de **utility tokens** com:

- **Ativos nativos** (Bode Coin, Verum Coin, Escoteiros Coin) e cotações
- **P2P** (ordem → Pix → confirmação → envio para auto-custódia na Verum Wallet)
- **Emissão B2B** (empresas, festas sertanejas, futebol, feiras culturais, ONGs)
- **Carteira** (validação estrita de endereços públicos da Verum Wallet)

**Stack:** Node.js 20+ · TypeScript · Express · Drizzle ORM · PostgreSQL · Zod · Pino · Helmet · Vitest

---

## 1. Rodando em 1 minuto

```bash
npm install
cp .env.example .env      # opcional: tudo tem valor padrão para desenvolvimento
npm run dev               # http://localhost:3333/api
```

Não precisa instalar banco de dados: em desenvolvimento a API usa o **PGlite**, um PostgreSQL embutido que salva os dados em `./data/pglite`. As migrations e o seed dos 3 ativos nativos rodam sozinhos quando o servidor sobe.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com hot-reload (`npm run dev \| npx pino-pretty` para logs legíveis) |
| `npm test` | Suíte completa (unitários + API ponta a ponta) |
| `npm run typecheck` | Verificação de tipos |
| `npm run build && npm start` | Build e execução de produção |
| `npm run db:generate` | Gera nova migration SQL após alterar `src/db/schema.ts` |
| `npm run db:migrate` / `db:seed` | Aplica migrations / insere ativos nativos manualmente |

### Usando PostgreSQL real (Supabase, Docker, RDS)

```bash
docker compose up -d                       # opcional: Postgres local
DATABASE_URL=postgres://cmmd:cmmd@localhost:5432/cmmd npm run dev
# Supabase: DATABASE_URL=postgres://...supabase.co:5432/postgres  DATABASE_SSL=true
```

O schema e as migrations são os mesmos para PGlite e Postgres.

---

## 2. Estrutura do projeto

```
cmmd-backend/
├── drizzle/                         # Migrations SQL versionadas (geradas do schema)
├── docs/api.http                    # Requisições prontas (VS Code REST Client / JetBrains)
├── src/
│   ├── server.ts                    # Bootstrap: env → banco → migrations → seed → HTTP
│   ├── app.ts                       # Composição: middlewares, serviços, rotas (injeção de dependências)
│   ├── config/
│   │   ├── env.ts                   # Variáveis de ambiente validadas com Zod (falha cedo)
│   │   └── constants.ts             # Aviso legal, ativos nativos, categorias, símbolos reservados
│   ├── db/
│   │   ├── schema.ts                # MODELOS: Token, P2POrder, P2POrderEvent, BusinessTokenRequest
│   │   ├── client.ts                # Conexão PGlite (dev/teste) ou Postgres (produção)
│   │   ├── seed.ts                  # Seed idempotente dos ativos nativos
│   │   └── cli.ts                   # npm run db:migrate | db:seed
│   ├── middlewares/
│   │   ├── request-logger.ts        # Log JSON (pino) + x-request-id
│   │   ├── security.ts              # Helmet, CORS, rate limit
│   │   ├── webhook-auth.ts          # x-webhook-secret (comparação em tempo constante)
│   │   └── error-handler.ts         # Erros → JSON padronizado + 404
│   ├── modules/
│   │   ├── tokens/                  # Ativos nativos e cotações
│   │   │   ├── tokens.routes.ts
│   │   │   ├── tokens.service.ts
│   │   │   └── price-feed.ts        # Oráculo de preços simulado (dev)
│   │   ├── wallet/                  # Validação Verum Wallet (Solana Ed25519 / EVM EIP-55)
│   │   ├── p2p/
│   │   │   ├── p2p.routes.ts
│   │   │   ├── p2p.service.ts       # Cotação, ordens, webhook, expiração, idempotência
│   │   │   ├── order-status.ts      # Máquina de estados
│   │   │   ├── payments/            # PaymentProvider + Pix simulado + gerador de BR Code
│   │   │   └── custody/             # TokenDispatcher (envio para auto-custódia)
│   │   └── b2b/
│   │       ├── b2b.routes.ts
│   │       ├── b2b.service.ts
│   │       └── compliance.ts        # Normas de utilidade (bloqueia promessa de lucro)
│   ├── shared/                      # money (BigInt), errors, logger, http helpers
│   └── types/express.d.ts
└── tests/                           # Vitest + Supertest (Postgres em memória)
```

Cada módulo segue **Routes → Service → Database**: rotas validam a entrada (Zod) e formatam a resposta; serviços concentram as regras de negócio; o acesso a dados passa pelo Drizzle.

---

## 3. Endpoints

Base: `http://localhost:3333`. Sucesso → `{ "data": ..., "meta"?: ... }`. Erro → `{ "error": { code, message, details?, requestId } }`.

### A. Ativos e cotações

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/tokens` | Ativos nativos com preço **real** (Solana), variação 24h, tendência e metadados. `?type=CUSTOM` lista tokens B2B aprovados |
| GET | `/api/tokens/:symbol` | Detalhes de um token (`BDC`, `VRC`, `ESCT`). 404 se não existir |
| GET | `/api/tokens/:symbol/activity` | Movimentação on-chain real via RPC pública da Solana: últimas transações (valor, origem, destino), supply e links Solscan. `?limit=1..25` |

```json
{
  "data": [{
    "id": "…", "name": "Bode Coin", "symbol": "BDC", "type": "NATIVE", "status": "ACTIVE",
    "chain": "solana", "mintAddress": "AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9",
    "explorerUrl": "https://solscan.io/token/…",
    "price": "0.16663517", "priceCurrency": "BRL", "change24h": -5.96, "trend": "DOWN",
    "decimals": 8, "description": "…", "iconUrl": "/assets/tokens/bode.svg", "updatedAt": "…"
  }],
  "meta": { "count": 3, "type": "NATIVE", "disclaimer": "Aviso importante: …" }
}
```

> **Preços reais**: com `PRICE_FEED_MODE=live` (padrão), o backend busca o preço dos pools
> on-chain (Jupiter Price API, com fallback DexScreener), converte para BRL com câmbio real
> (AwesomeAPI/open.er-api.com) e atualiza o banco a cada `PRICE_FEED_INTERVAL_MS`.
> `PRICE_FEED_MODE=simulated` reativa o passeio aleatório local (sem rede).

> Preços e valores são **strings decimais** (precisão exata). Toda a aritmética usa BigInt; nunca float.

### B. Transações P2P

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/p2p/orders` | Cria a ordem, trava a cotação e gera a cobrança Pix |
| GET | `/api/p2p/orders/:id` | Status atual + linha do tempo. `?qrcode=false` omite a imagem |
| POST | `/api/p2p/orders/:id/cancel` | Cancelamento pelo usuário (somente `PENDING`) |
| PATCH | `/api/p2p/orders/:id/status` | **Webhook** de pagamento. Exige `x-webhook-secret` |

**Criar ordem**

```http
POST /api/p2p/orders
Content-Type: application/json
Idempotency-Key: checkout-7f3a9c21        # opcional, evita ordem duplicada em retry

{ "assetSymbol": "BDC", "fiatAmount": 500, "userWalletAddress": "<endereço Verum Wallet>" }
```

Regras:
- `fiatAmount` em BRL, número ou string (`"500,00"`), no máximo 2 casas, entre `P2P_MIN_FIAT` e `P2P_MAX_FIAT`.
- Taxa: `P2P_FEE_BPS` (padrão 1,5%), arredondada ao centavo.
- `tokenAmount = (fiatAmount − taxa) / cotação`, com 8 casas e arredondado **para baixo** (a plataforma nunca envia a mais).
- A cotação fica travada na ordem (`unitPrice`).
- A cobrança vence em `ORDER_TTL_MINUTES`. Depois disso a ordem vira `EXPIRED` e não aceita pagamento.

Resposta `201`: `status: "PENDING"`, `fiatAmount: "500.00"`, `feeAmount: "7.50"`, `tokenAmount: "579.41176470"` e um bloco `payment` com `pixCopyPaste` (BR Code EMV com CRC16 válido), `qrCodeDataUrl` (PNG), `txid`, `expiresAt` e `simulated: true`.

**Status da ordem**

```
PENDING (Pendente) ──► PAID (Pago) ──► COMPLETED (Concluído / Enviado)
   ├──► CANCELLED (Cancelado)
   └──► EXPIRED   (Expirado, só o sistema define)
```

**Webhook de pagamento**

```http
PATCH /api/p2p/orders/:id/status
x-webhook-secret: <WEBHOOK_SECRET>
Content-Type: application/json

{ "status": "PAID", "paymentReference": "E2E-ID-DO-PIX" }   # depois: { "status": "COMPLETED" }
```

- `COMPLETED` chama o **TokenDispatcher**, que envia os tokens para a Verum Wallet e grava o `custody.txHash`.
- Com `AUTO_SETTLE=true`, receber `PAID` já executa o envio e conclui a ordem.
- Reenvio do mesmo status é **idempotente**: responde `200` com `meta.changed=false` e não envia de novo.
- Webhooks simultâneos travam a linha da ordem (`SELECT … FOR UPDATE`), então os tokens nunca são enviados em duplicidade.
- Transição inválida → `409 INVALID_STATUS_TRANSITION`. Pagamento após vencimento → `409 ORDER_EXPIRED`.
- Falha no envio on-chain → `502 DISPATCH_FAILED`, e a ordem continua `PAID` para nova tentativa.

### C. Emissão B2B — "Crie o Utility Token do seu Negócio"

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/b2b/tokens/categories` | Categorias aceitas |
| POST | `/api/b2b/tokens/create` | Registra a solicitação (status `PENDING_REVIEW`) |
| GET | `/api/b2b/tokens/requests/:id` | Consulta por id (uuid) ou protocolo (`UTK-XXXXXXXXXX`) |

```json
{
  "tokenName": "Rodeio Coin",
  "symbol": "RODEIO",
  "category": "Festas Sertanejas",
  "purpose": "Ingresso, consumo no bar e votação da atração do próximo ano.",
  "creatorWallet": "<endereço Verum Wallet>",
  "acceptUtilityTerms": true,
  "contactEmail": "contato@rodeio.com",
  "totalSupply": "1000000"
}
```

`category` aceita o código (`EMPRESAS`, `FESTAS_SERTANEJAS`, `FUTEBOL`, `FEIRAS_CULTURAIS`, `AJUDA_HUMANITARIA`) ou o rótulo do frontend (`"Ajuda Humanitária"`, `"ONG"`, …).

Regras de negócio:
- **Vínculo às normas de utilidade:** `acceptUtilityTerms: true` é obrigatório. A solicitação é gravada com `utilityClass = UTILITY_COMMUNITY_EDUCATIONAL`, `isSecurity = false`, `profitGuarantee = false`, versão dos termos, data do aceite e o aviso legal.
- **Compliance automático:** nome e propósito que prometam lucro, rendimento, dividendos, "% ao mês", "sem risco" etc. são recusados com `400 COMPLIANCE_VIOLATION`.
- **Símbolo:** 2–8 caracteres. Não pode repetir um token listado ou uma solicitação ativa, nem usar símbolos reservados (nativos, BTC, USDT, BRL…). Nesses casos responde `409 SYMBOL_UNAVAILABLE`.
- **creatorWallet** passa pela mesma validação estrita da auto-custódia.

### Carteira

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/wallet/validate` | `{ "address": "…" }` → `{ valid, network, address }` |

Validação estrita:
- **Solana:** base58 que decodifica para exatamente 32 bytes, e a chave precisa estar na curva **Ed25519**. Endereços fora da curva são PDAs (contas de programa, não de auto-custódia) e são recusados. O System Program também é bloqueado.
- **EVM:** `0x` + 40 hex. Se o endereço tiver maiúsculas e minúsculas, o checksum **EIP-55** precisa conferir. O endereço nulo é bloqueado e a resposta sempre devolve a forma com checksum.
- **Proteção do usuário:** se ele colar uma **frase-semente** ou uma **chave privada**, a API recusa com código específico (`SEED_PHRASE_DETECTED`, `PRIVATE_KEY_DETECTED`).
- As redes aceitas são configuráveis em `WALLET_NETWORKS`.

### Infra

`GET /health` (testa o banco) · `GET /api` (índice das rotas)

---

## 4. Erros (códigos HTTP)

| HTTP | Quando | Exemplos de `code` |
|---|---|---|
| 200 / 201 | Sucesso / criado | — |
| 400 | Entrada inválida | `VALIDATION_ERROR`, `INVALID_JSON`, `WALLET_INVALID_FORMAT`, `SEED_PHRASE_DETECTED`, `FIAT_AMOUNT_OUT_OF_RANGE`, `COMPLIANCE_VIOLATION` |
| 401 | Webhook sem segredo válido | `UNAUTHORIZED` |
| 404 | Recurso inexistente | `TOKEN_NOT_FOUND`, `ORDER_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | Conflito de estado | `INVALID_STATUS_TRANSITION`, `ORDER_EXPIRED`, `SYMBOL_UNAVAILABLE`, `IDEMPOTENCY_KEY_REUSED` |
| 413 | Corpo > 20 KB | `PAYLOAD_TOO_LARGE` |
| 429 | Limite de requisições | `RATE_LIMITED` |
| 500 | Erro inesperado | `INTERNAL_ERROR` (sem detalhes internos para o cliente) |
| 502 | Falha no envio on-chain | `DISPATCH_FAILED` |

`VALIDATION_ERROR` traz `details: [{ field, message }]` para o frontend destacar cada campo.

---

## 5. Segurança

- **Helmet:** CSP restritiva, `nosniff`, `frame-ancestors 'none'`, sem `x-powered-by`.
- **CORS:** origens permitidas em `CORS_ORIGINS`. Em produção, defina o domínio do frontend.
- **Rate limit:** 600 req/15 min por IP no geral e 20 req/min nas rotas de escrita.
- **Webhook:** `x-webhook-secret` comparado em tempo constante. Em produção o boot falha se o segredo estiver ausente ou com o valor de exemplo.
- **Logs:** JSON estruturado com `x-request-id`. Corpo das requisições e headers sensíveis não são registrados.
- Body limitado a 20 KB, validação Zod em todas as entradas e SQL parametrizado (Drizzle).

---

## 6. Do simulado para o real

As duas integrações externas ficam atrás de interfaces e são trocadas em `src/app.ts`:

| Interface | Hoje | Produção |
|---|---|---|
| `PaymentProvider` (`p2p/payments`) | `SimulatedPixProvider`: BR Code com chave sandbox | Asaas / Efí / Mercado Pago: criar a cobrança e mapear o webhook do provedor para `PATCH /status` |
| `TokenDispatcher` (`p2p/custody`) | `SimulatedTokenDispatcher`: hash fictício | `@solana/web3.js` + SPL Token (ou viem para EVM), assinando por uma hot wallet de tesouraria com limites |
| `SimulatedPriceFeed` | Passeio aleatório ±0,4% (só fora de produção) | Fonte real (pool on-chain / livro P2P) |

> ⚠️ O Pix e o envio de tokens são **simulados**. Nenhum valor real é cobrado ou transferido.

---

## 7. Modelo de dados

Definido em [`src/db/schema.ts`](src/db/schema.ts); SQL em [`drizzle/0000_init.sql`](drizzle/0000_init.sql).

- **tokens**: `id`, `name`, `symbol` (único), `price`, `change24h`, `referencePrice24h`, `type` (`NATIVE` | `CUSTOM`), `status`, `decimals`, `sortOrder`, `description`, `iconUrl`, `businessRequestId`, timestamps
- **p2p_orders**: `id`, `assetSymbol` → tokens, `fiatAmount`, `feeAmount`, `unitPrice`, `tokenAmount`, `userWalletAddress`, `walletNetwork`, `status`, `paymentProvider`, `paymentTxid`, `pixPayload`, `paymentReference`, `expiresAt`, `paidAt`, `custodyTxHash`, `completedAt`, `cancelledAt`, `idempotencyKey`, `createdAt`, `updatedAt`
- **p2p_order_events**: trilha de auditoria (`fromStatus` → `toStatus`, origem, nota, data)
- **business_token_requests**: `id`, `protocol`, `tokenName`, `symbol`, `category`, `purpose`, `creatorWallet`, `creatorWalletNetwork`, `contactEmail`, `totalSupply`, `status`, `utilityClass`, `termsVersion`, `termsAcceptedAt`, `isSecurity`, `profitGuarantee`, `compliance` (jsonb), `createdAt`. Índice único parcial impede o mesmo símbolo em duas solicitações ativas.

Valores monetários usam `NUMERIC`, nunca `float`.
