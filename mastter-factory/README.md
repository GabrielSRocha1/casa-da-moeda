# Mastter.Digital — Smart Contract Factory (Solana / Anchor / Token-2022)

Programa único ("Contrato Mãe") que cria e administra cofres tokenizados independentes para
várias entidades. Cada entidade recebe seu próprio token SPL Token-2022, cofres de lastro em
SOL e USDC, vesting on-chain de 30%, limites anti-whale e cadastro on-chain.

**Estado desta entrega:** compila para SBF, IDL gerada, 46 testes de integração TypeScript e
4 testes unitários Rust aprovados localmente, e um teste de ponta a ponta contra um validador
Solana local (`scripts/localnet-e2e.sh`: deploy, criação de entidade, compra, resgate, injeção).
**Não foi implantado em Devnet/Mainnet, não leu uma conta real da Pyth e não foi auditado por
terceiros** (ver [seção 11](#11-auditoria-e-implantação-na-mainnet)).

---

## 1. Arquitetura

```
                         ┌────────────────────────────┐
                         │ FactoryConfig  ["config"]  │  admin, carteira de receita,
                         │ (única por programa)       │  USDC, oráculo, pausa global
                         └─────────────┬──────────────┘
           initialize_entity_vault + activate_entity_vault (somente admin)
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
  Entidade 1                     Entidade 2                     Entidade N
  EntityVault ["entity_vault", id]
   ├─ RegistryData    ["registry", vault]        dados cadastrais
   ├─ BackingLedger   ["ledger", vault]          lastro, taxas, lucro, contadores
   ├─ Mint Token-2022 ["mint", vault]            authority = vault, freeze = nula
   ├─ VestingAccount  ["vesting", vault]         30% do Hard Cap
   ├─ Escrow vesting  ["vesting_escrow", vault]  conta Token-2022 do PDA
   ├─ Cofre SOL       ["sol_treasury", vault]    PDA de sistema
   ├─ Cofre USDC      ["usdc_treasury", vault]   conta SPL Token do PDA
   ├─ BuyerRecord     ["buyer", vault, carteira] controle de compras por carteira
   └─ ProfitReceipt   ["profit", vault, ref_id]  recibo único de cada repasse
```

Todas as PDAs derivam do `EntityVault`, que deriva do `entity_id`. Os bumps ficam armazenados
no cofre e são verificados em toda instrução; contas de uma entidade nunca são aceitas em
operações de outra (testado).

### Precificação (unidade comum: nano-USD)

SOL e USDC nunca são somados diretamente. Cada saldo é convertido para USD pelo oráculo:

```
NAV            = lastro_SOL × preço_SOL + lastro_USDC × preço_USDC
supply_ref     = supply circulante + supply bloqueado em vesting
preço unitário = NAV / supply_ref
compra : tokens = (valor líquido pago) × supply_ref / NAV
resgate: valor  = tokens × NAV / supply_ref   (pago em SOL ou USDC)
```

- **Lastro contabilizado, não saldo bruto.** O NAV usa os contadores do `BackingLedger`, que só
  mudam por instruções do programa. Depósitos diretos nos cofres não alteram o preço.
- **Taxas nunca entram no lastro.** São enviadas à carteira de receita na mesma transação e
  contabilizadas à parte (`*_fees_collected`).
- **Vesting participa do supply de referência.** Os 30% bloqueados têm direito pro-rata ao
  lastro desde a ativação, então o `claim` não dilui ninguém e o preço não salta quando os
  tokens são liberados. Consequência: a entidade também se beneficia das injeções de lucro
  sobre a parcela ainda bloqueada.
- **Intervalo de confiança contra o operador.** Na compra o pagamento é avaliado em
  `preço − conf` e o lastro em `preço + conf`; no resgate, o inverso. Ida e volta imediata
  nunca gera lucro (testado).
- Arredondamentos sempre a favor do cofre. Toda a aritmética usa `checked_*` em `u128`.

---

## 2. Estrutura de diretórios

```
mastter-factory/
├── Anchor.toml
├── Cargo.toml / Cargo.lock
├── package.json / tsconfig.json
├── programs/mastter_factory/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs            entrypoint: 16 instruções
│       ├── constants.rs      seeds, taxa, Hard Caps, vesting, limites
│       ├── errors.rs         39 códigos de erro
│       ├── events.rs         13 eventos
│       ├── state.rs          contas on-chain (InitSpace)
│       ├── math.rs           aritmética segura, vesting, janela horária (+ testes)
│       ├── oracle.rs         leitura e validação de PriceUpdateV2 (Pyth)
│       └── instructions/
│           ├── admin.rs      factory: init, config, pausa, troca de admin
│           ├── entity.rs     cofre: cadastro, ativação, config, pausa, close_minting
│           ├── buy.rs        buy_tokens
│           ├── sell.rs       sell_tokens
│           ├── profit.rs     inject_daily_profit
│           ├── vesting.rs    claim_vested_tokens
│           └── snapshot.rs   emit_vault_snapshot
├── tests/
│   ├── helpers.ts            ambiente bankrun, mock de oráculo, espelho das fórmulas
│   └── mastter_factory.test.ts
├── scripts/initialize-factory.ts
└── idl/                      IDL e tipos TypeScript gerados
```

---

## 3. Decisões que precisam do seu aval

Pontos em que o prompt era ambíguo ou esbarrava em limite técnico. Estão implementados como
descrito; mudar qualquer um é localizado.

| Tema | Decisão adotada | Motivo |
|---|---|---|
| `initialize_entity_vault` | Dividida em duas instruções: `initialize_entity_vault` (todos os parâmetros, cadastro, ledger) e `activate_entity_vault` (mint, vesting, cofres, lastro inicial). | Uma transação Solana tem 1.232 bytes; os dados cadastrais mais ~17 contas não cabem em uma só. O cofre fica `PendingActivation` e não opera até a ativação. |
| `initial_pool_amount` | Aporte inicial **em USDC**, obrigatório (> 0), feito pelo `funder` na ativação. | Define o preço inicial: `pool / (30% do Hard Cap)`. Sem lastro inicial o preço seria indefinido. |
| `hard_cap` | Informado em tokens inteiros (25M / 50M / 100M); `min_buy`, `max_buy`, `max_wallet` em unidades-base do token. | Evita ambiguidade com decimais. |
| `platform_fee` | Padrão 119 bps (1,19%), configurável por cofre só pelo admin, teto de 500 bps. | "Taxa padrão configurada no contrato". |
| Taxa em `inject_daily_profit` | Desligada por padrão; liga por cofre com `charge_fee_on_profit`. | "Liquidações financeiras" é ambíguo; ficou configurável. |
| `verum_wallet_address` | Imutável após o cadastro. Deve ser conta de sistema (wallet), diferente da carteira de receita. Ela mesma assina o `claim`. | Destino exclusivo do vesting. |
| 24 meses | 730 dias contados da ativação; carência de 180 dias incluída; liberação linear por segundo entre o dia 180 e o dia 730. | Conforme pedido. |
| Pausa | Pausar bloqueia compras, **resgates**, injeções e claims do cofre. | É pausa de emergência. Atenção: dá ao admin o poder de congelar resgates. |
| Vesting × `max_wallet` | A Verum Wallet recebe o vesting sem passar pelo limite anti-whale. | 30% do Hard Cap sempre excede o limite por carteira. |

---

## 4. Instruções

### Administração da Factory
| Instrução | Quem | O que faz |
|---|---|---|
| `initialize_factory(args)` | upgrade authority do programa | Cria `FactoryConfig`: admin, carteira de receita, mint USDC (obrigatoriamente SPL Token clássico), programa e contas de oráculo, feed IDs, idade máxima do preço (≤ 600 s), confiança máxima (≤ 5%), offset UTC operacional. Só a upgrade authority pode chamar, o que impede front-running do deploy. |
| `update_factory_config(args)` | admin | Atualiza oráculo, limites e carteira de receita padrão. Emite `AdministrativeConfigurationUpdated`. |
| `set_factory_paused(bool)` | admin | Pausa/retoma todos os cofres. |
| `propose_admin(pubkey)` / `accept_admin()` | admin / novo admin | Troca de administração em dois passos. |

### Cofre da entidade
| Instrução | Quem | O que faz |
|---|---|---|
| `initialize_entity_vault(args)` | admin | Valida Hard Cap (somente 25M/50M/100M), decimais (≤ 9), anti-whale (`0 < min ≤ max_buy ≤ max_wallet ≤ hard_cap`), taxa, strings e Verum Wallet. Cria `EntityVault`, `RegistryData`, `BackingLedger`. Emite `EntityVaultInitialized`. |
| `activate_entity_vault(token_uri, image_sha256)` | admin + funder | Cria o mint Token-2022 (authority = PDA do cofre, freeze nula, extensões MetadataPointer + TokenMetadata com nome/símbolo/URI), grava o hash da imagem e **revoga a autoridade de atualização dos metadados** (ver seção 10), cria o escrow, o `VestingAccount` e os cofres; cunha 30% do Hard Cap no escrow; transfere o lastro inicial em USDC. Emite `EntityVaultActivated`. |
| `update_entity_config(args)` | admin | Ajusta anti-whale, taxa (≤ 5%), remetente autorizado de lucro, taxa sobre injeções e carteira de receita do cofre. |
| `update_registry_data(args)` | admin | Atualiza o cadastro; mantém `registered_*`, `last_updated_*` e `update_count`. |
| `set_vault_paused(bool)` | admin | Pausa/retoma um cofre. Emite `VaultPaused` / `VaultResumed`. |
| `close_minting(confirm=true)` | admin | **Irreversível.** Revoga a Mint Authority do token. Ver seção 10. |

### Operações financeiras
| Instrução | Quem | O que faz |
|---|---|---|
| `buy_tokens(asset, amount_in, min_tokens_out, deadline_ts)` | qualquer usuário | Valida estado, ativo, saldo e oráculo; calcula taxa (1,19%, uma vez) e tokens; aplica slippage, `min_buy`, `max_buy`, `max_wallet` (saldo e compras líquidas) e Hard Cap **antes** de mover qualquer valor; envia taxa à carteira de receita e o líquido ao cofre; cunha para o comprador. Emite `TokenPurchased`, `PlatformFeeCollected` e, se for o caso, `HardCapReached`. |
| `sell_tokens(asset, token_amount, min_amount_out, deadline_ts)` | detentor | Calcula o valor proporcional; exige que o valor bruto caiba no lastro contabilizado **e** no saldo real do cofre do ativo escolhido; queima os tokens; paga o líquido e a taxa. Emite `TokenRedeemed`, `PlatformFeeCollected`. |
| `inject_daily_profit(asset, amount, reference_id, origin)` | `profit_injector` do cofre | Recebe SOL ou USDC, aumenta o lastro, **não cunha nem altera supply**. Cria um `ProfitReceipt` por `reference_id` (um segundo envio com o mesmo id falha). Registra data/hora, entidade, origem e se caiu na janela recomendada (dia útil, ≥ 19h no fuso configurado) — informativo, nunca bloqueia. Emite `ProfitInjected`. |
| `claim_vested_tokens()` | Verum Wallet | Calcula o liberado pelo timestamp on-chain, desconta o já sacado e transfere do escrow para uma conta Token-2022 da própria Verum Wallet. Emite `VestedTokensClaimed`. |
| `emit_vault_snapshot()` | qualquer um | Emite `VaultSnapshot`: NAV, preço por token, parcela reservada para resgates do circulante, parcela vinculada ao vesting, taxas e lucros acumulados. |

`deadline_ts = 0` desativa o prazo. `min_tokens_out` / `min_amount_out` são a proteção de slippage.

---

## 5. Contas on-chain

| Conta | Conteúdo principal |
|---|---|
| `FactoryConfig` | admin, admin pendente, carteira de receita, USDC, oráculo (programa, contas, feed IDs, limites), taxa padrão, pausa, contagem de entidades |
| `EntityVault` | identificação, autoridade, Verum Wallet, carteira de receita, mint, cofres, Hard Cap, anti-whale, taxa, supply circulante / bloqueado / cunhado / queimado, status, bumps |
| `BackingLedger` | lastro SOL e USDC, taxas coletadas, lucro injetado, entradas por compra, saídas por resgate, contadores de operações |
| `VestingAccount` | cofre, mint, escrow, beneficiário, total, liberado, restante, início, carência, término |
| `RegistryData` | empresa, endereço, telefone, país, diretores, pagador, nº de contrato, histórico de registro |
| `BuyerRecord` | total comprado, total resgatado, compras líquidas, nº de compras |
| `ProfitReceipt` | remetente, origem, ativo, bruto, taxa, líquido, timestamp, hora/dia local |

Espaço: `8 + INIT_SPACE` em todas; Strings com `#[max_len]` (nome 32, símbolo 10, empresa 64,
endereço 128, telefone 24, país 32, diretores 160, pagador 64, origem 48, URI 200 bytes).

**Segregação contábil** pedida na seção 9 do prompt:

| Item | Onde fica |
|---|---|
| Lastro disponível | `BackingLedger.sol_backing` / `usdc_backing` |
| Reservado para resgates | derivado: `NAV × circulante / supply_ref` (em `VaultSnapshot`) |
| Valores de vesting | derivado: `NAV × bloqueado / supply_ref`; tokens no escrow |
| Receita da plataforma | `*_fees_collected` (já fora dos cofres) |
| Depósitos de lucro | `*_profit_injected` + `ProfitReceipt` |
| Supply circulante / bloqueado | `EntityVault.circulating_supply` / `vesting_locked_supply` |

O modelo é de resgate imediato, então não existe fila de resgates pendentes: todo o lastro
pertence pro-rata aos tokens existentes.

---

## 6. Eventos

`FactoryInitialized`, `EntityVaultInitialized`, `EntityVaultActivated`, `TokenPurchased`,
`TokenRedeemed`, `ProfitInjected`, `VestedTokensClaimed`, `PlatformFeeCollected`,
`HardCapReached`, `VaultPaused`, `VaultResumed`, `AdministrativeConfigurationUpdated`,
`VaultSnapshot`. Todos trazem `entity_id`, cofre, carteira envolvida, valores, ativo e timestamp.

---

## 7. Segurança

| Requisito | Implementação |
|---|---|
| PDAs, seeds, bumps | `seeds` + `bump` armazenado em todas as contas do programa |
| `has_one`, `address`, `owner`, `constraint`, `Signer` | usados em todas as structs de contas; ver `instructions/*.rs` |
| Token Program / Mint / Token Accounts | token da entidade: só Token-2022 (`mint::token_program`, `token::token_program`); USDC: só SPL Token clássico e `address = config.usdc_mint` |
| Tokens falsificados | mint e contas validados por endereço, mint e dono (testado) |
| Reentrância | o runtime Solana impede reentrância por CPI; mesmo assim o código segue checks → effects → interactions |
| Replay / duplicidade | assinaturas e blockhash do runtime; `deadline_ts`; `ProfitReceipt` único por `reference_id`; `init` impede recriação de cofres |
| Overflow / underflow | `checked_*` em tudo; `overflow-checks = true` no perfil release |
| Slippage | `min_tokens_out`, `min_amount_out` |
| Saldo antes de transferir | saldo do usuário, lastro contabilizado e saldo real do cofre |
| Oráculo | dono, endereço fixado, discriminador, feed ID, verificação completa, preço > 0, idade, confiança, banda aplicada contra o operador |
| Pausa emergencial | por cofre e global |
| Permissões | admin único em `FactoryConfig`, troca em dois passos; init restrito à upgrade authority |

### Limitações conhecidas (leia antes da Mainnet)

1. **Anti-whale e transferências.** O limite por carteira confere o saldo da conta **e** as
   compras líquidas registradas no `BuyerRecord`, então esvaziar a carteira por transferência
   não libera novo limite (testado). O que o contrato **não** impede: uma pessoa usando várias
   carteiras, ou receber tokens por transferência acima do limite. Um Transfer Hook do
   Token-2022 limitaria o saldo por conta nas transferências, mas não resolve múltiplas
   carteiras (isso exige KYC/allowlist off-chain) e quebraria a compatibilidade com parte das
   DEXs e carteiras. Não foi implementado; é uma decisão de produto.
2. **Compra antes da injeção de lucro.** Quem vê uma injeção grande pendente pode comprar
   antes e resgatar depois, capturando parte do lucro. O custo é 2,38% de taxas na ida e volta
   e o ganho é limitado pelo `max_wallet`. Mitigações operacionais: injeções frequentes e
   pequenas em relação ao NAV, envio por RPC privado, `max_wallet` conservador.
3. **Centralização.** O admin pode pausar (inclusive resgates), mudar taxa até 5%, trocar o
   oráculo e a carteira de receita. Use multisig (por exemplo Squads) como admin e como
   upgrade authority.
4. **Dependência do oráculo.** Sem preço válido de SOL **e** de USDC, compras e resgates param.
   Injeções e claims continuam.
5. **Resgate em um único ativo.** O usuário escolhe SOL ou USDC; se o cofre daquele ativo não
   cobre o valor, a transação falha e ele usa o outro ou divide o resgate.
6. **Carteira de receita** precisa ter saldo em SOL (isenção de aluguel) e uma conta USDC criada.
7. **Cofres já criados** guardam a própria carteira de receita; mudar a padrão da Factory não
   altera os existentes (use `update_entity_config`).

### Nota regulatória

Um token com lastro, resgate pelo valor patrimonial e valorização por repasse de lucros da
entidade tem características que reguladores (CVM, CNV, SEC) costumam enquadrar como valor
mobiliário. O contrato não resolve isso. Recomendo parecer jurídico antes de ofertar ao público.

---

## 8. Dependências externas

| Dependência | Uso | Configuração |
|---|---|---|
| **Pyth (Pull Oracle / Solana Receiver)** | preços SOL/USD e USDC/USD | `oracle_program`, `sol_price_account`, `usdc_price_account`, `sol_feed_id`, `usdc_feed_id` em `initialize_factory` |
| **USDC** | ativo de pagamento e lastro | `usdc_mint` em `initialize_factory` |

Nenhum endereço externo está embutido no código. Obtenha os valores do cluster na documentação
oficial da Pyth (programa Receiver, feed IDs e endereços das *price feed accounts* patrocinadas,
deriváveis com `getPriceFeedAccountAddress(shard, feedId)` do SDK `@pythnetwork/pyth-solana-receiver`)
e da Circle (mint do USDC). As *price feed accounts* patrocinadas são atualizadas continuamente
pela Pyth; se usar contas próprias, sua infraestrutura precisa postar atualizações antes de cada
operação.

**Atenção — upgrade do Pyth Core (2026).** A Pyth passou a publicar na Solana por programas
novos ("Pyth Core Compatible" / *pro-compatible*), com outros IDs de programa e outros endereços
de *push feed accounts*; a orientação oficial para implantações novas é usar esses, não os
legados. Como este contrato não embute endereços, basta informar os novos em
`initialize_factory`. O que precisa ser confirmado em Devnet antes de qualquer valor real:
que o layout e o discriminador de `PriceUpdateV2` dos programas novos são os que `oracle.rs`
lê, e qual é o intervalo real de atualização dos feeds SOL/USD e USDC/USD (para calibrar
`max_price_age_secs`). Alternativa: trocar a leitura manual pelo `pyth-solana-receiver-sdk`
com a feature `pro-compatible`, que exige Anchor 0.32.1 ou superior.
Referência: https://docs.pyth.network/price-feeds/core/upgrade/preparing/solana

O módulo `oracle.rs` lê o layout público de `PriceUpdateV2` sem depender do SDK Rust da Pyth.
Nos testes as contas são simuladas com esse mesmo layout; **a leitura de uma conta real da Pyth
ainda precisa ser validada em Devnet.**

---

## 9. Compilação, testes e Devnet

### Versões
- Anchor `0.31.1` (crates `anchor-lang` / `anchor-spl`)
- Solana/Agave CLI `2.3.x` (platform-tools v1.48, Rust 1.84 para SBF)
- SPL Token-2022 `6.0` (via `anchor-spl`)
- Node 20+

### Compilar
```bash
npm install
anchor keys sync          # gera SEU program id e atualiza declare_id! e Anchor.toml
anchor build              # gera target/deploy/*.so e target/idl/*.json
```
O `Cargo.lock` enviado fixa versões compatíveis com o Rust 1.84 das platform-tools. Se
regenerá-lo e aparecer `feature edition2024 is required`, rode:
```bash
CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile
cargo update -p blake3 --precise 1.8.2
```
O program id que está em `lib.rs` / `Anchor.toml` foi gerado só para os testes locais e a chave
privada não acompanha a entrega: `anchor keys sync` é obrigatório.

### Testar
```bash
anchor build && npm test                                   # 46 testes de integração
cargo test --manifest-path programs/mastter_factory/Cargo.toml --lib   # 4 testes unitários
```
Os testes usam `solana-bankrun`: executam o `.so` real com SPL Token e Token-2022 reais e
relógio controlável (necessário para o vesting de 180/730 dias). Não precisam de validador.

### Validador local (ponta a ponta)
```bash
anchor build && ./scripts/localnet-e2e.sh
```
Sobe um `solana-test-validator` limpo, implanta o `.so` pelo loader atualizável e executa o
fluxo completo com todas as Strings no tamanho máximo. Medições da última execução:

| Transação | bytes (máx. 1.232) | compute units (padrão 200.000) |
|---|---|---|
| `initialize_factory` | 559 | 13.274 |
| `initialize_entity_vault` (Strings no máximo) | 1.087 | 39.572 |
| `activate_entity_vault` (URI de 200 bytes) | 885 | 109.820 |
| `buy_tokens` USDC / SOL | 804 / 740 | 63.233 / 45.451 |
| `sell_tokens` USDC / SOL | 804 / 740 | 55.927 / 41.592 |
| `inject_daily_profit` | 683 | 40.786 |
| `emit_vault_snapshot` | 382 | 15.631 |

As contas de preço desse teste são simuladas. O deploy do binário (~872 KB) exige cerca de
6,1 SOL de depósito de aluguel na Mainnet, recuperáveis se o programa for fechado.

### Devnet
```bash
solana config set --url devnet
solana airdrop 5
anchor build
anchor deploy --provider.cluster devnet
# inicializar a Factory (variáveis descritas no topo do script)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
USDC_MINT=... REVENUE_WALLET=... ORACLE_PROGRAM=... \
SOL_PRICE_ACCOUNT=... SOL_FEED_ID=... USDC_PRICE_ACCOUNT=... USDC_FEED_ID=... \
npx ts-node scripts/initialize-factory.ts
```
Depois: `initialize_entity_vault` → `activate_entity_vault` → compra, resgate, injeção e
snapshot com o oráculo real. O script de inicialização passou na checagem de tipos, mas não foi
executado contra um cluster.

---

## 10. Operações irreversíveis

### Identidade do token (nome, símbolo, imagem) — imutável desde a ativação
`activate_entity_vault` grava nome, símbolo, URI dos metadados e o SHA-256 do arquivo de imagem
(campo `image_sha256` nos metadados Token-2022 e em `EntityVault.image_sha256`) e, na mesma
transação, revoga a autoridade de atualização dos metadados. A partir daí:
- ninguém altera nome, símbolo, URI ou hash, nem o admin (o Token-2022 responde
  `ImmutableMetadata`; testado);
- o programa não tem nenhuma instrução que toque em metadados;
- um erro de digitação ou uma imagem errada **não tem conserto**: confira antes de ativar.

O que fica na Solana é o hash e o link, não os bytes da imagem. Para a imagem ser de fato
eterna, o arquivo e o JSON de metadados precisam estar em armazenamento permanente
(Arweave; ou IPFS com fixação garantida). Um link `https://` comum pode sair do ar ou ter o
conteúdo trocado; nesse caso o hash on-chain prova a troca, mas não traz a imagem de volta.
A hospedagem é uma dependência externa ainda não integrada.

A autoridade do *MetadataPointer* continua com o PDA do cofre, que só assina por instruções
deste programa, e nenhuma existe para isso. Enquanto o programa for atualizável, uma nova
versão poderia criar uma; é mais um motivo para manter a upgrade authority em multisig.

### `close_minting` — revogação da Mint Authority
- Nunca mais será possível cunhar aquele token: `buy_tokens` passa a falhar para sempre.
- A elasticidade acaba: tokens queimados em resgates não voltam.
- Resgates, injeções de lucro e o vesting (já cunhado no escrow) continuam funcionando.
- Use somente quando a emissão estiver encerrada de fato.

### Revogação da Upgrade Authority do programa
```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```
- O programa fica imutável: **nenhum bug poderá ser corrigido**, nenhuma função adicionada.
- Se a Pyth migrar de programa ou de layout de conta, `update_factory_config` troca endereços,
  mas não o código de leitura: compras e resgates podem parar sem conserto possível.
- Não há como desfazer. Chaves, multisig ou suporte da Solana não recuperam a authority.
- Só execute após auditoria externa, período de operação em Mainnet sem incidentes e aprovação
  expressa e registrada. Alternativa intermediária: manter a authority em multisig com timelock.

---

## 11. Auditoria e implantação na Mainnet

1. **Congelar o código** em um commit e gerar build verificável (`anchor build --verifiable`).
2. **Auditoria externa** por empresa especializada em Solana/Anchor. Focos sugeridos:
   precificação e arredondamentos, uso do oráculo, contas opcionais, `init_if_needed` do
   `BuyerRecord`, poderes do admin, itens 1 e 2 das limitações conhecidas.
3. **Devnet completo** com oráculo Pyth real e USDC de Devnet, exercitando todas as instruções.
4. **Testes adicionais recomendados:** fuzzing das fórmulas (por exemplo Trident), teste de
   carga com muitos cofres, simulação de variação brusca de preço.
5. **Chaves:** admin e upgrade authority em multisig; carteira de receita e Verum Wallets
   conferidas por dois responsáveis antes de cada cadastro (a Verum Wallet é imutável).
6. **Deploy:** `anchor deploy --provider.cluster mainnet` com a keypair do programa guardada
   offline; `initialize_factory` na mesma sessão; transferir a upgrade authority ao multisig.
7. **Verificação pós-deploy:** `solana program show`, `anchor verify`, leitura do
   `FactoryConfig`, um cofre piloto com valores baixos.
8. **Monitoramento:** indexar os eventos; alertar em `VaultPaused`,
   `AdministrativeConfigurationUpdated`, `HardCapReached` e em divergência entre saldo real dos
   cofres e `BackingLedger` (o saldo real deve ser sempre ≥ ao contabilizado).
9. **Imutabilidade (opcional):** somente após os passos acima, conforme a seção 10.

---

## 12. Cobertura de testes

| # do prompt | Cenário | Teste |
|---|---|---|
| 1, 2 | múltiplas entidades, três Hard Caps | `1+2.` |
| 3 | Hard Cap inválido | `3.` |
| 4, 5, 6 | compra com SOL / USDC, taxa de 1,19% | `4+6.`, `5+6.` |
| 7, 8, 9 | mínimo, máximo, limite por carteira | `7.`, `8.`, `9.` |
| 10 | Hard Cap atingido | `10.` |
| 11 | resgate e queima | `11.`, `11b.` |
| 12, 13 | injeção sem cunhagem, lastro por token maior | `12+13.` |
| 14, 15, 16, 17 | vesting: carência, liberação, destino, duplicidade | `14.`–`17.` |
| 18 | acesso administrativo não autorizado | `18.` |
| 19 | falhas de oráculo | `19.` |
| 20 | saldo insuficiente para resgate | `20.` |

Identidade imutável: metadados e hash on-chain, tentativas de troca de imagem/símbolo/nome/URI
rejeitadas, ativação sem URI ou sem hash rejeitada.

Cenários de ataque e extras: init por não-authority, reinicialização, mint USDC falso,
ativação dupla, contas de outra entidade, desvio da taxa, doação direta ao cofre, transferência
para burlar `max_wallet`, conta de preço forjada, repasse duplicado, banda de confiança,
slippage e prazo, pausa por cofre e global, troca de admin, `close_minting`, cofre totalmente
resgatado, invariantes contábeis finais.
