# Casa da Moeda Master Digital

Plataforma comunitária de **utility tokens** (Bode Coin, Verum Coin, Escoteiros Coin) com:

- **Site**: carrossel dos ativos, compra **P2P via Pix** com entrega na **Verum Wallet** (auto-custódia) e **Solicitação de Parceria** para instituições que querem o próprio token.
- **API (backend)**: Node.js + TypeScript + Express + Drizzle + PostgreSQL.
- **Supabase**: migrations SQL com RLS, webhook seguro de pagamento, views do dashboard e tabela de parcerias.

> ⚠️ Pix e envio de tokens estão **simulados**. Nenhum valor real é cobrado ou transferido. Veja [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md).

---

## Estrutura

```
casa-da-moeda-master-digital/
├── frontend/                 Site (HTML + JavaScript nativo + Tailwind compilado localmente)
│   ├── index.html            Página única: carrossel, P2P, parceria B2B, aviso legal
│   ├── assets/app.css        CSS gerado (não editar à mão → npm run build:css)
│   ├── tailwind.config.js    Paleta oficial e fontes
│   ├── scripts/              Servidor local e modo dev
│   └── tests/                Testes de navegador (Playwright/Python)
├── backend/                  API REST (P2P, tokens, carteira, emissão B2B) — ver backend/README.md
├── supabase/
│   ├── migrations/
│   │   ├── 001_casa_da_moeda_master_digital.sql   Tokens, ordens P2P, webhook, RLS, dashboard
│   │   └── 002_business_applications.sql          Solicitações de parceria (formulário do site)
│   └── tests/                Testes das migrations (Postgres embutido simulando o Supabase)
├── docs/PENDENCIAS.md        O que falta para produção e decisões em aberto
└── .cursor/rules/            Contexto do projeto para a IA do Cursor
```

---

## Começando (5 minutos)

Pré-requisitos: **Node.js 20+**. Para os testes do site: **Python 3.10+**.

```bash
npm run setup          # instala dependências de frontend, backend e supabase
```

### Site

```bash
npm run dev:site       # http://localhost:5173 (recompila o CSS ao salvar)
```

Também dá para abrir `frontend/index.html` direto no navegador: o CSS é local e o site funciona offline.

**Conectar o formulário de parceria ao Supabase:** em `frontend/index.html`, preencha:

```html
<meta name="cmmd-supabase-url" content="https://SEU-PROJETO.supabase.co" />
<meta name="cmmd-supabase-anon-key" content="SUA_CHAVE_ANON_PUBLICA" />
```

Com os campos vazios, o formulário roda em **modo demonstração** (salva só no navegador e avisa na tela).
**Nunca** coloque a chave `service_role` no site.

### API

```bash
npm run dev:api        # http://localhost:3333/api
```

Não precisa instalar banco: em desenvolvimento a API usa PostgreSQL embutido (PGlite).
Para Postgres/Supabase, defina `DATABASE_URL` em `backend/.env` (modelo em `backend/.env.example`).

### Supabase

No **SQL Editor** do projeto, rode em ordem:

1. `supabase/migrations/001_casa_da_moeda_master_digital.sql`
2. `supabase/migrations/002_business_applications.sql`

Os dois podem ser executados de novo sem duplicar nada.

---

## Testes

```bash
npm test               # backend + supabase + site
```

| Parte | Comando | Testes |
|---|---|---|
| Backend (unitários + API ponta a ponta) | `npm --prefix backend test` | 64 |
| Supabase: plataforma (RLS, webhook, B2B, dashboard) | `npm --prefix supabase test` | 86 |
| Supabase: parcerias (payloads reais do formulário) | `npm --prefix supabase test` | 37 |
| Site: carrossel, P2P, aviso legal, responsivo | `npm --prefix frontend test` | 56 |
| Site: formulário de parceria (desktop + celular) | `npm --prefix frontend test` | 79 |

Testes do site, só na primeira vez:

```bash
pip install -r frontend/tests/requirements.txt
python -m playwright install chromium
```

No Windows, se `python3` não existir, rode os testes do site com `python frontend/tests/test_site.py` e `python frontend/tests/test_parceria.py`.

Capturas de tela e os payloads enviados ao Supabase ficam em `frontend/tests/output/`.

---

## Identidade visual

| Uso | Cor |
|---|---|
| Estrutura (fundos, cabeçalho, cards) | Azul `#082B63` / `#0B4AA8`, Amarelo `#F5C400`, Branco |
| Texto | Cinza `#4B5563` |
| Ação, sucesso, alta | Verde `#16A34A` |
| Alerta, cancelamento, baixa | Vermelho `#DC2626` |

Fontes: Inter (texto) e Sora (títulos), via Google Fonts. Se não carregarem, o site usa a fonte do sistema.

---

## Aviso legal

O texto obrigatório aparece fixo no rodapé do site e é devolvido pela API (`meta.disclaimer`).
Ele está reproduzido **literalmente** como foi especificado, inclusive a palavra "comprimento". Veja a pendência sobre isso em `docs/PENDENCIAS.md`.
