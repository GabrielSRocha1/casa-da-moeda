/**
 * Mastter.Digital Factory — testes de integração e cenários de ataque.
 * Executa contra o binário SBF real (target/deploy/mastter_factory.so) em solana-bankrun,
 * com SPL Token e Token-2022 reais e relógio controlável (vesting).
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getExtensionData,
} from "@solana/spl-token";
import { createUpdateAuthorityInstruction, createUpdateFieldInstruction, unpack as unpackMetadata } from "@solana/spl-token-metadata";
import { createHash } from "crypto";
import { assert } from "chai";
import {
  Env,
  EntityPdas,
  MOCK_ORACLE_PROGRAM,
  P,
  PROGRAM_ID,
  SOL,
  SOL_FEED_ID,
  USDC,
  USDC_FEED_ID,
  buyerPda,
  configPda,
  createClassicMint,
  createTokenAccount,
  entityPdas,
  fails,
  fee,
  fund,
  lamports,
  mintClassic,
  mintInfo,
  now,
  ok,
  parseEvents,
  profitPda,
  quoteBuy,
  quoteSell,
  refreshPrices,
  setPrice,
  startEnv,
  tokenBalance,
  warpTo,
} from "./helpers";

const DAY = 86_400n;
const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDC -> unidades-base
const bn = (v: bigint | number) => new BN(v.toString());
/** SHA-256 de um arquivo de imagem de exemplo (bytes arbitrários, só para os testes). */
const imageHash = (id: number | string) => createHash("sha256").update(`imagem-da-moeda-${id}`).digest();
const TOKEN_URI = "https://example.invalid/metadata.json";

describe("Mastter.Digital Factory", () => {
  let env: Env;
  let program: any;
  const config = configPda();

  const revenue = Keypair.generate();
  const injector = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const carol = Keypair.generate();
  const mallory = Keypair.generate();
  const verum: Record<number, Keypair> = { 1: Keypair.generate(), 2: Keypair.generate(), 3: Keypair.generate(), 4: Keypair.generate() };

  let usdcMint: PublicKey;
  let fakeUsdcMint: PublicKey;
  let adminUsdc: PublicKey;
  let revenueUsdc: PublicKey;
  const usdcOf = new Map<string, PublicKey>();
  const tokOf = new Map<string, PublicKey>(); // `${entity}:${user}`

  const E1 = entityPdas(1); // 25M, 6 decimais
  const E2 = entityPdas(2); // 50M, 9 decimais
  const E3 = entityPdas(3); // 100M, 0 decimais
  const E4 = entityPdas(4); // 25M, 2 decimais (cenário de Hard Cap)

  const T6 = (n: number) => BigInt(Math.round(n * 1e6)); // tokens da entidade 1 -> unidades-base

  // ------------------------------------------------------------------ builders
  function entityArgs(id: number, o: any = {}) {
    return {
      tokenName: o.tokenName ?? `Entidade ${id} Token`,
      tokenSymbol: o.tokenSymbol ?? `ENT${id}`,
      decimals: o.decimals ?? 6,
      entityId: bn(id),
      contractNumber: bn(2026000 + id),
      companyName: o.companyName ?? `Empresa ${id} S.A.`,
      address: "Av. Principal, 1000 - Centro",
      phone: "+595 61 000 000",
      country: "Paraguay",
      directorsNames: "Diretor Um; Diretora Dois",
      payerName: "Pagador Responsavel",
      verumWalletAddress: o.verumWalletAddress ?? verum[id].publicKey,
      initialPoolAmount: bn(o.initialPool ?? U(75_000)),
      hardCap: bn(o.hardCap ?? 25_000_000),
      minBuy: bn(o.minBuy ?? T6(10)),
      maxBuy: bn(o.maxBuy ?? T6(1_000_000)),
      maxWallet: bn(o.maxWallet ?? T6(2_000_000)),
      platformFee: o.platformFee ?? 119,
      profitInjector: injector.publicKey,
      chargeFeeOnProfit: o.chargeFeeOnProfit ?? false,
    };
  }

  function initEntityIx(e: EntityPdas, args: any, signer: PublicKey = env.admin.publicKey, verumAccount?: PublicKey): Promise<TransactionInstruction> {
    return program.methods
      .initializeEntityVault(args)
      .accountsStrict({
        admin: signer,
        config,
        vault: e.vault,
        registry: e.registry,
        ledger: e.ledger,
        verumWallet: verumAccount ?? args.verumWalletAddress,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  function activateIx(e: EntityPdas, o: any = {}): Promise<TransactionInstruction> {
    return program.methods
      .activateEntityVault(o.uri ?? TOKEN_URI, [...(o.hash ?? imageHash(e.entityId.toString()))])
      .accountsStrict({
        admin: env.admin.publicKey,
        funder: env.admin.publicKey,
        config,
        vault: e.vault,
        ledger: e.ledger,
        mint: e.mint,
        vesting: e.vesting,
        vestingEscrow: e.vestingEscrow,
        solTreasury: e.solTreasury,
        usdcTreasury: e.usdcTreasury,
        usdcMint: o.usdcMint ?? usdcMint,
        funderUsdcAccount: adminUsdc,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async function createEntity(id: number, e: EntityPdas, o: any = {}) {
    await ok(env, [await initEntityIx(e, entityArgs(id, o))]);
    await ok(env, [await activateIx(e)]);
  }

  async function tokenAccountFor(e: EntityPdas, user: Keypair): Promise<PublicKey> {
    const key = `${e.entityId.toString()}:${user.publicKey.toBase58()}`;
    if (!tokOf.has(key)) tokOf.set(key, await createTokenAccount(env, e.mint, user.publicKey, TOKEN_2022_PROGRAM_ID));
    return tokOf.get(key)!;
  }

  async function buyIx(e: EntityPdas, user: Keypair, asset: any, amount: bigint, o: any = {}): Promise<TransactionInstruction> {
    const isUsdc = !!asset.usdc;
    return program.methods
      .buyTokens(asset, bn(amount), bn(o.minOut ?? 0n), bn(o.deadline ?? 0n))
      .accountsStrict({
        user: user.publicKey,
        config,
        vault: o.vault ?? e.vault,
        ledger: o.ledger ?? e.ledger,
        mint: o.mint ?? e.mint,
        userTokenAccount: o.userTokenAccount ?? (await tokenAccountFor(e, user)),
        buyerRecord: buyerPda(o.vault ?? e.vault, user.publicKey),
        solTreasury: o.solTreasury ?? e.solTreasury,
        usdcTreasury: o.usdcTreasury ?? e.usdcTreasury,
        usdcMint: o.usdcMint ?? usdcMint,
        userUsdcAccount: isUsdc ? o.userUsdc ?? usdcOf.get(user.publicKey.toBase58())! : null,
        revenueWallet: o.revenueWallet ?? revenue.publicKey,
        revenueUsdcAccount: isUsdc ? o.revenueUsdc ?? revenueUsdc : null,
        solPriceFeed: o.solPriceFeed ?? env.solPriceFeed,
        usdcPriceFeed: o.usdcPriceFeed ?? env.usdcPriceFeed,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async function sellIx(e: EntityPdas, user: Keypair, asset: any, tokens: bigint, o: any = {}): Promise<TransactionInstruction> {
    const isUsdc = !!asset.usdc;
    return program.methods
      .sellTokens(asset, bn(tokens), bn(o.minOut ?? 0n), bn(o.deadline ?? 0n))
      .accountsStrict({
        user: user.publicKey,
        config,
        vault: e.vault,
        ledger: e.ledger,
        mint: e.mint,
        userTokenAccount: await tokenAccountFor(e, user),
        buyerRecord: o.noRecord ? null : buyerPda(e.vault, user.publicKey),
        solTreasury: e.solTreasury,
        usdcTreasury: e.usdcTreasury,
        usdcMint,
        userUsdcAccount: isUsdc ? usdcOf.get(user.publicKey.toBase58())! : null,
        revenueWallet: revenue.publicKey,
        revenueUsdcAccount: isUsdc ? revenueUsdc : null,
        solPriceFeed: env.solPriceFeed,
        usdcPriceFeed: env.usdcPriceFeed,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async function injectIx(e: EntityPdas, signer: Keypair, asset: any, amount: bigint, ref: number, o: any = {}): Promise<TransactionInstruction> {
    const isUsdc = !!asset.usdc;
    return program.methods
      .injectDailyProfit(asset, bn(amount), bn(ref), o.origin ?? "PDV-LOJA-01")
      .accountsStrict({
        injector: signer.publicKey,
        config,
        vault: e.vault,
        ledger: e.ledger,
        receipt: profitPda(e.vault, bn(ref)),
        solTreasury: e.solTreasury,
        usdcTreasury: e.usdcTreasury,
        usdcMint,
        injectorUsdcAccount: isUsdc ? usdcOf.get(signer.publicKey.toBase58())! : null,
        revenueWallet: revenue.publicKey,
        revenueUsdcAccount: isUsdc ? revenueUsdc : null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  function claimIx(e: EntityPdas, beneficiary: PublicKey, destination: PublicKey): Promise<TransactionInstruction> {
    return program.methods
      .claimVestedTokens()
      .accountsStrict({
        beneficiary,
        config,
        vault: e.vault,
        ledger: e.ledger,
        vesting: e.vesting,
        escrow: e.vestingEscrow,
        mint: e.mint,
        destination,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  const vaultOf = (e: EntityPdas) => program.account.entityVault.fetch(e.vault);
  const ledgerOf = (e: EntityPdas) => program.account.backingLedger.fetch(e.ledger);
  const big = (v: BN) => BigInt(v.toString());

  async function state(e: EntityPdas) {
    const v = await vaultOf(e);
    const l = await ledgerOf(e);
    return {
      v,
      l,
      sol: big(l.solBacking),
      usdc: big(l.usdcBacking),
      circ: big(v.circulatingSupply),
      locked: big(v.vestingLockedSupply),
      ref: big(v.circulatingSupply) + big(v.vestingLockedSupply),
    };
  }

  function factoryArgs() {
    return {
      oracleProgram: MOCK_ORACLE_PROGRAM,
      solPriceAccount: env.solPriceFeed,
      usdcPriceAccount: env.usdcPriceFeed,
      solFeedId: [...SOL_FEED_ID],
      usdcFeedId: [...USDC_FEED_ID],
      maxPriceAgeSecs: bn(60),
      maxConfBps: 100,
      opsUtcOffsetSecs: -10_800,
    };
  }

  function initFactoryIx(signer: PublicKey, mint: PublicKey): Promise<TransactionInstruction> {
    return program.methods
      .initializeFactory(factoryArgs())
      .accountsStrict({
        admin: signer,
        config,
        program: PROGRAM_ID,
        programData: env.programData,
        usdcMint: mint,
        revenueWallet: revenue.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // ------------------------------------------------------------------ setup
  before(async () => {
    env = await startEnv();
    program = env.program;

    for (const kp of [revenue, injector, alice, bob, carol, mallory, ...Object.values(verum)]) {
      await fund(env, kp.publicKey, 100);
    }
    usdcMint = await createClassicMint(env, 6, env.admin.publicKey);
    fakeUsdcMint = await createClassicMint(env, 6, env.admin.publicKey);
    adminUsdc = await createTokenAccount(env, usdcMint, env.admin.publicKey);
    revenueUsdc = await createTokenAccount(env, usdcMint, revenue.publicKey);
    await mintClassic(env, usdcMint, adminUsdc, U(10_000_000));
    for (const kp of [injector, alice, bob, carol, mallory]) {
      const acc = await createTokenAccount(env, usdcMint, kp.publicKey);
      usdcOf.set(kp.publicKey.toBase58(), acc);
      await mintClassic(env, usdcMint, acc, U(1_000_000));
    }
    await refreshPrices(env);
  });

  // ================================================================== Factory
  describe("Factory e administração", () => {
    it("[ataque] initialize_factory por quem não é upgrade authority é rejeitado", async () => {
      await fails(env, [await initFactoryIx(mallory.publicKey, usdcMint)], [mallory], "NotUpgradeAuthority", mallory);
    });

    it("initialize_factory pela upgrade authority registra a configuração global", async () => {
      await ok(env, [await initFactoryIx(env.admin.publicKey, usdcMint)]);
      const c = await program.account.factoryConfig.fetch(config);
      assert.ok(c.admin.equals(env.admin.publicKey));
      assert.ok(c.revenueWallet.equals(revenue.publicKey));
      assert.ok(c.usdcMint.equals(usdcMint));
      assert.equal(c.defaultFeeBps, 119);
      assert.equal(c.usdcDecimals, 6);
    });

    it("[ataque] reinicialização da Factory é impossível", async () => {
      await fails(env, [await initFactoryIx(env.admin.publicKey, usdcMint)], [], "already in use");
    });
  });

  // ================================================================== Entidades
  describe("Cadastro de entidades (Factory Pattern)", () => {
    it("1+2. cria múltiplas entidades independentes com os três Hard Caps (25M, 50M, 100M)", async () => {
      await createEntity(1, E1, { hardCap: 25_000_000, decimals: 6 });
      await createEntity(2, E2, {
        hardCap: 50_000_000,
        decimals: 9,
        initialPool: U(150_000),
        minBuy: 10n * 10n ** 9n,
        maxBuy: 1_000_000n * 10n ** 9n,
        maxWallet: 2_000_000n * 10n ** 9n,
      });
      await createEntity(3, E3, {
        hardCap: 100_000_000,
        decimals: 0,
        initialPool: U(300_000),
        minBuy: 10n,
        maxBuy: 1_000_000n,
        maxWallet: 2_000_000n,
      });

      const caps: [EntityPdas, bigint, number][] = [
        [E1, 25_000_000n * 10n ** 6n, 6],
        [E2, 50_000_000n * 10n ** 9n, 9],
        [E3, 100_000_000n, 0],
      ];
      const mints = new Set<string>();
      for (const [e, cap, dec] of caps) {
        const s = await state(e);
        assert.equal(big(s.v.hardCap), cap);
        assert.deepEqual(s.v.status, { active: {} });
        // 30% do Hard Cap cunhado e bloqueado no escrow de vesting
        assert.equal(s.locked, (cap * 30n) / 100n);
        assert.equal(s.circ, 0n);
        assert.equal(await tokenBalance(env, e.vestingEscrow, TOKEN_2022_PROGRAM_ID), (cap * 30n) / 100n);
        // Token-2022: mint authority = PDA do cofre, freeze authority nula
        const m = await mintInfo(env, e.mint);
        assert.ok(m.mintAuthority!.equals(e.vault));
        assert.isNull(m.freezeAuthority);
        assert.equal(m.decimals, dec);
        assert.equal(m.supply, (cap * 30n) / 100n);
        const info = await env.client.getAccount(e.mint);
        assert.ok(info!.owner.equals(TOKEN_2022_PROGRAM_ID));
        mints.add(e.mint.toBase58());
        // segregação: cada entidade tem suas próprias contas
        assert.ok(s.v.mint.equals(e.mint) && s.v.ledger.equals(e.ledger) && s.v.usdcTreasury.equals(e.usdcTreasury));
        assert.ok(s.l.vault.equals(e.vault));
      }
      assert.equal(mints.size, 3);

      const s1 = await state(E1);
      assert.equal(s1.usdc, U(75_000));
      assert.equal(await tokenBalance(env, E1.usdcTreasury), U(75_000));
      const reg = await program.account.registryData.fetch(E1.registry);
      assert.equal(reg.companyName, "Empresa 1 S.A.");
      assert.equal(reg.country, "Paraguay");
      assert.ok(reg.registeredBy.equals(env.admin.publicKey));
      const vest = await program.account.vestingAccount.fetch(E1.vesting);
      assert.ok(vest.beneficiary.equals(verum[1].publicKey));
      assert.equal(big(vest.cliffTs) - big(vest.startTs), 180n * DAY);
      assert.equal(big(vest.endTs) - big(vest.startTs), 730n * DAY);
      const c = await program.account.factoryConfig.fetch(config);
      assert.equal(c.entityCount.toString(), "3");
    });

    it("3. rejeita Hard Cap fora das três opções", async () => {
      const e = entityPdas(99);
      for (const bad of [10_000_000, 25_000_001, 75_000_000, 200_000_000, 0]) {
        await fails(env, [await initEntityIx(e, { ...entityArgs(1, { hardCap: bad }), entityId: bn(99) })], [], "InvalidHardCap");
      }
      assert.isNull(await env.client.getAccount(e.vault));
    });

    it("rejeita parâmetros inválidos (anti-whale, taxa, strings, Verum Wallet, entidade duplicada)", async () => {
      const e = entityPdas(98);
      const base = (o: any) => ({ ...entityArgs(1, o), entityId: bn(98) });
      await fails(env, [await initEntityIx(e, base({ minBuy: T6(100), maxBuy: T6(10) }))], [], "InvalidAntiWhaleParams");
      await fails(env, [await initEntityIx(e, base({ maxWallet: 26_000_000n * 10n ** 6n, maxBuy: T6(10) }))], [], "InvalidAntiWhaleParams");
      await fails(env, [await initEntityIx(e, base({ platformFee: 501 }))], [], "InvalidFee");
      await fails(env, [await initEntityIx(e, base({ decimals: 10 }))], [], "InvalidDecimals");
      await fails(env, [await initEntityIx(e, base({ companyName: "   " }))], [], "InvalidStringLength");
      await fails(env, [await initEntityIx(e, base({ initialPool: 0n }))], [], "InvalidAmount");
      // Verum Wallet: conta passada difere do parâmetro
      await fails(env, [await initEntityIx(e, base({}), env.admin.publicKey, mallory.publicKey)], [], "InvalidVerumWallet");
      // Verum Wallet: não pode ser uma conta de programa/token (não é wallet de sistema)
      await fails(env, [await initEntityIx(e, base({ verumWalletAddress: usdcMint }))], [], "InvalidVerumWallet");
      // Verum Wallet: não pode ser a carteira de receita
      await fails(env, [await initEntityIx(e, base({ verumWalletAddress: revenue.publicKey }))], [], "InvalidVerumWallet");
      // entity_id já existente
      await fails(env, [await initEntityIx(E1, entityArgs(1))], [], "already in use");
    });

    it("[ataque] ativação com mint USDC falsificado é rejeitada; ativação dupla é impossível", async () => {
      const e = entityPdas(97);
      await ok(env, [await initEntityIx(e, { ...entityArgs(1), entityId: bn(97) })]);
      await fails(env, [await activateIx(e, { usdcMint: fakeUsdcMint })], [], "ConstraintAddress");
      await fails(env, [await activateIx(E1)], [], "already in use");
      // cofre ainda não ativado não aceita compras
      await fails(env, [await buyIx(E1, alice, USDC, U(100), { vault: e.vault, ledger: e.ledger })], [alice], "Error", alice);
    });
  });

  // ================================================================== Identidade
  describe("Identidade do token imutável (nome, símbolo, imagem)", () => {
    async function metadataOf(e: EntityPdas) {
      const m = await mintInfo(env, e.mint);
      return unpackMetadata(getExtensionData(ExtensionType.TokenMetadata, m.tlvData)!);
    }

    it("nome, símbolo, URI e hash da imagem ficam on-chain e a autoridade de atualização é revogada", async () => {
      const md = await metadataOf(E1);
      assert.equal(md.name, "Entidade 1 Token");
      assert.equal(md.symbol, "ENT1");
      assert.equal(md.uri, TOKEN_URI);
      assert.ok(md.mint.equals(E1.mint));
      assert.deepEqual(md.additionalMetadata, [["image_sha256", imageHash(1).toString("hex")]]);
      assert.ok(!md.updateAuthority || md.updateAuthority.equals(PublicKey.default), "update authority revogada");
      const v = await vaultOf(E1);
      assert.equal(Buffer.from(v.imageSha256).toString("hex"), imageHash(1).toString("hex"));
      // cada entidade guarda o hash da própria imagem
      const md2 = await metadataOf(E2);
      assert.deepEqual(md2.additionalMetadata, [["image_sha256", imageHash(2).toString("hex")]]);
    });

    it("[ataque] ninguém consegue trocar imagem, símbolo, nome ou URI depois da criação", async () => {
      const before = await metadataOf(E1);
      const attempt = (authority: PublicKey, field: string, value: string) =>
        createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: E1.mint, updateAuthority: authority, field, value });
      // 0x35c2b5c1 = TokenMetadataError::ImmutableMetadata (metadados sem autoridade de atualização)
      const IMMUTABLE = "0x35c2b5c1";
      // o próprio admin da Factory
      await fails(env, [attempt(env.admin.publicKey, "uri", "https://example.invalid/outra-imagem.json")], [], IMMUTABLE);
      await fails(env, [attempt(env.admin.publicKey, "symbol", "FAKE")], [], IMMUTABLE);
      await fails(env, [attempt(env.admin.publicKey, "image_sha256", "00".repeat(32))], [], IMMUTABLE);
      // um terceiro
      await fails(env, [attempt(mallory.publicKey, "name", "Token Falso")], [mallory], IMMUTABLE, mallory);
      // tentar se nomear autoridade de atualização
      await fails(
        env,
        [createUpdateAuthorityInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: E1.mint, oldAuthority: env.admin.publicKey, newAuthority: env.admin.publicKey })],
        [],
        IMMUTABLE
      );
      // o programa não expõe nenhuma instrução que altere metadados
      const names: string[] = program.idl.instructions.map((i: any) => i.name);
      assert.isFalse(names.some((n) => /metadata|image|uri|symbol/i.test(n)));
      assert.deepEqual(await metadataOf(E1), before);
    });

    it("ativação exige URI dos metadados e hash da imagem", async () => {
      const e = entityPdas(97); // cadastrada e ainda não ativada
      await fails(env, [await activateIx(e, { hash: Buffer.alloc(32) })], [], "InvalidImageHash");
      await fails(env, [await activateIx(e, { uri: "" })], [], "InvalidStringLength");
      await fails(env, [await activateIx(e, { uri: "   " })], [], "InvalidStringLength");
      assert.isNull(await env.client.getAccount(e.mint));
    });
  });

  // ================================================================== Compras
  describe("buy_tokens, taxa e anti-whale", () => {
    it("4+6. compra com SOL: cunhagem exata, taxa de 1,19% na carteira de receita, lastro atualizado", async () => {
      const amount = BigInt(LAMPORTS_PER_SOL);
      const before = await state(E1);
      const q = quoteBuy("sol", amount, before.sol, before.usdc, before.ref);
      assert.equal(q.fee, 11_900_000n); // 1,19% de 1 SOL
      assert.equal(q.tokens, 14_821_500_000n); // US$ 148,215 a US$ 0,01

      const revBefore = await lamports(env, revenue.publicKey);
      const treBefore = await lamports(env, E1.solTreasury);
      const logs = await ok(env, [await buyIx(E1, alice, SOL, amount, { minOut: q.tokens })], [alice], alice);

      assert.equal(await tokenBalance(env, await tokenAccountFor(E1, alice), TOKEN_2022_PROGRAM_ID), q.tokens);
      assert.equal((await lamports(env, revenue.publicKey)) - revBefore, q.fee);
      assert.equal((await lamports(env, E1.solTreasury)) - treBefore, q.net);
      const after = await state(E1);
      assert.equal(after.sol, q.net);
      assert.equal(after.circ, q.tokens);
      assert.equal(big(after.l.solFeesCollected), q.fee);
      assert.equal((await mintInfo(env, E1.mint)).supply, before.ref + q.tokens);

      const evs = parseEvents(env, logs);
      const purchased = evs.find((e) => e.name === "tokenPurchased" || e.name === "TokenPurchased")!;
      assert.ok(purchased, "evento TokenPurchased");
      assert.equal(purchased.data.tokensMinted.toString(), q.tokens.toString());
      assert.equal(purchased.data.feeAmount.toString(), q.fee.toString());
      const feeEvs = evs.filter((e) => e.name.toLowerCase() === "platformfeecollected");
      assert.equal(feeEvs.length, 1, "taxa cobrada uma única vez");
    });

    it("5+6. compra com USDC: cunhagem exata e taxa de 1,19% em USDC", async () => {
      const amount = U(100);
      const before = await state(E1);
      const q = quoteBuy("usdc", amount, before.sol, before.usdc, before.ref);
      assert.equal(q.fee, 1_190_000n); // US$ 1,19
      assert.equal(q.tokens, 9_881_000_000n); // 9.881 tokens

      const revBefore = await tokenBalance(env, revenueUsdc);
      const treBefore = await tokenBalance(env, E1.usdcTreasury);
      await ok(env, [await buyIx(E1, bob, USDC, amount)], [bob], bob);

      assert.equal(await tokenBalance(env, await tokenAccountFor(E1, bob), TOKEN_2022_PROGRAM_ID), q.tokens);
      assert.equal((await tokenBalance(env, revenueUsdc)) - revBefore, q.fee);
      assert.equal((await tokenBalance(env, E1.usdcTreasury)) - treBefore, q.net);
      const after = await state(E1);
      assert.equal(after.usdc - before.usdc, q.net);
      assert.equal(big(after.l.usdcFeesCollected), q.fee);
      // a compra não altera o preço por token (sem diluição): NAV/supply antes == depois
      const navB = before.sol * 150n * 10n ** 6n / 10n ** 9n + before.usdc;
      const navA = after.sol * 150n * 10n ** 6n / 10n ** 9n + after.usdc;
      assert.ok(navA * before.ref >= navB * after.ref);
    });

    it("7. bloqueia compra abaixo do mínimo por transação", async () => {
      await fails(env, [await buyIx(E1, bob, USDC, U(0.05))], [bob], "BelowMinBuy", bob);
    });

    it("8. bloqueia compra acima do máximo por transação", async () => {
      await fails(env, [await buyIx(E1, bob, USDC, U(20_000))], [bob], "AboveMaxBuy", bob);
    });

    it("9. bloqueia por limite máximo da carteira (saldo e compras líquidas)", async () => {
      await ok(env, [await buyIx(E1, carol, USDC, U(10_000))], [carol], carol);
      await ok(env, [await buyIx(E1, carol, USDC, U(10_000))], [carol], carol);
      const bal = await tokenBalance(env, await tokenAccountFor(E1, carol), TOKEN_2022_PROGRAM_ID);
      assert.equal(bal, 1_976_200_000_000n); // 2 x 988.100 tokens
      await fails(env, [await buyIx(E1, carol, USDC, U(10_000))], [carol], "MaxWalletExceeded", carol);
      // ainda cabe uma compra pequena dentro do limite
      await ok(env, [await buyIx(E1, carol, USDC, U(100))], [carol], carol);
    });

    it("[ataque] esvaziar a carteira por transferência não libera novo limite (net_acquired)", async () => {
      const carolTok = await tokenAccountFor(E1, carol);
      const malloryTok = await tokenAccountFor(E1, mallory);
      const bal = await tokenBalance(env, carolTok, TOKEN_2022_PROGRAM_ID);
      await ok(env, [createTransferCheckedInstruction(carolTok, E1.mint, malloryTok, carol.publicKey, bal, 6, [], TOKEN_2022_PROGRAM_ID)], [carol], carol);
      assert.equal(await tokenBalance(env, carolTok, TOKEN_2022_PROGRAM_ID), 0n);
      await fails(env, [await buyIx(E1, carol, USDC, U(10_000))], [carol], "MaxWalletExceeded", carol);
      const rec = await program.account.buyerRecord.fetch(buyerPda(E1.vault, carol.publicKey));
      assert.equal(big(rec.netAcquired), bal);
    });

    it("controle de slippage e prazo (deadline)", async () => {
      const s = await state(E1);
      const q = quoteBuy("usdc", U(100), s.sol, s.usdc, s.ref);
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { minOut: q.tokens + 1n })], [bob], "SlippageExceeded", bob);
      const t = await now(env);
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { deadline: t - 1n })], [bob], "DeadlineExceeded", bob);
      await ok(env, [await buyIx(E1, bob, USDC, U(100), { minOut: q.tokens, deadline: t + 60n })], [bob], bob);
    });

    it("[ataque] contas de outra entidade, mint falso e carteira de receita trocada são rejeitados", async () => {
      // ledger / tesouraria / mint da entidade 2 dentro de uma compra na entidade 1
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { ledger: E2.ledger })], [bob], "Error", bob);
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { usdcTreasury: E2.usdcTreasury })], [bob], "Error", bob);
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { mint: E2.mint })], [bob], "Error", bob);
      // pagar com token falsificado
      const fakeAcc = await createTokenAccount(env, fakeUsdcMint, bob.publicKey);
      await mintClassic(env, fakeUsdcMint, fakeAcc, U(1_000));
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { usdcMint: fakeUsdcMint, userUsdc: fakeAcc })], [bob], "ConstraintTokenMint", bob);
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { userUsdc: fakeAcc })], [bob], "ConstraintTokenMint", bob);
      // desviar a taxa para a carteira do atacante
      await fails(env, [await buyIx(E1, bob, SOL, BigInt(LAMPORTS_PER_SOL), { revenueWallet: mallory.publicKey })], [bob], "InvalidRevenueWallet", bob);
      await fails(
        env,
        [await buyIx(E1, bob, USDC, U(100), { revenueUsdc: usdcOf.get(mallory.publicKey.toBase58()) })],
        [bob],
        "ConstraintTokenOwner",
        bob
      );
      // usar a conta de tokens de outra pessoa como destino
      await fails(env, [await buyIx(E1, bob, USDC, U(100), { userTokenAccount: await tokenAccountFor(E1, mallory) })], [bob], "ConstraintTokenOwner", bob);
    });

    it("[ataque] doação direta ao cofre não altera o lastro contabilizado nem o preço", async () => {
      const before = await state(E1);
      const q0 = quoteBuy("usdc", U(100), before.sol, before.usdc, before.ref);
      await ok(env, [createTransferInstruction(usdcOf.get(mallory.publicKey.toBase58())!, E1.usdcTreasury, mallory.publicKey, U(50_000))], [mallory], mallory);
      await ok(env, [SystemProgram.transfer({ fromPubkey: mallory.publicKey, toPubkey: E1.solTreasury, lamports: 5 * LAMPORTS_PER_SOL })], [mallory], mallory);
      const after = await state(E1);
      assert.equal(after.usdc, before.usdc);
      assert.equal(after.sol, before.sol);
      const bobTok = await tokenAccountFor(E1, bob);
      const b0 = await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID);
      await ok(env, [await buyIx(E1, bob, USDC, U(100))], [bob], bob);
      assert.equal((await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID)) - b0, q0.tokens);
    });

    it("intervalo de confiança do oráculo é sempre aplicado contra o operador (anti-arbitragem)", async () => {
      // SOL = 150 ± 0,75 (0,5%), USDC = 1 ± 0,005
      await refreshPrices(env, 150_00000000n, 1_00000000n, 75000000n);
      const s = await state(E1);
      const mid = quoteBuy("sol", BigInt(LAMPORTS_PER_SOL), s.sol, s.usdc, s.ref);
      const band = quoteBuy("sol", BigInt(LAMPORTS_PER_SOL), s.sol, s.usdc, s.ref, P(150, 0.75), P(1, 0.005));
      assert.ok(band.tokens < mid.tokens);
      const bobTok = await tokenAccountFor(E1, bob);
      const b0 = await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID);
      await ok(env, [await buyIx(E1, bob, SOL, BigInt(LAMPORTS_PER_SOL))], [bob], bob);
      const got = (await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID)) - b0;
      assert.equal(got, band.tokens);
      // ida e volta imediata nunca dá lucro
      const s2 = await state(E1);
      const back = quoteSell("sol", got, s2.sol, s2.usdc, s2.ref, P(150, 0.75), P(1, 0.005));
      assert.ok(back.net < BigInt(LAMPORTS_PER_SOL));
      await refreshPrices(env);
    });
  });

  // ================================================================== Hard Cap
  describe("Hard Cap e cunhagem elástica", () => {
    it("10. bloqueia ao atingir o Hard Cap, emite HardCapReached e reabre após queima", async () => {
      // Entidade 4: 25M tokens, 2 decimais, preço inicial US$ 0,001 (pool 7.500 / 7,5M tokens)
      const cap = 25_000_000n * 100n;
      await createEntity(4, E4, { hardCap: 25_000_000, decimals: 2, initialPool: U(7_500), minBuy: 100n, maxBuy: cap, maxWallet: cap });
      const s0 = await state(E4);
      const remaining = cap - s0.ref;
      assert.equal(remaining, 17_500_000n * 100n);

      // valor bruto cujo líquido (após 1,19%) é exatamente US$ 17.500 => 17,5M tokens
      const gross = 17_710_758_020n;
      const q = quoteBuy("usdc", gross, s0.sol, s0.usdc, s0.ref);
      assert.equal(q.net, U(17_500));
      assert.equal(q.tokens, remaining);

      // acima do restante: rejeitado e nada é cunhado
      await fails(env, [await buyIx(E4, alice, USDC, gross + U(1))], [alice], "HardCapExceeded", alice);

      const logs = await ok(env, [await buyIx(E4, alice, USDC, gross)], [alice], alice);
      const s1 = await state(E4);
      assert.equal(s1.ref, cap);
      assert.equal((await mintInfo(env, E4.mint)).supply, cap);
      const evs = parseEvents(env, logs);
      assert.ok(evs.some((e) => e.name.toLowerCase() === "hardcapreached"), "evento HardCapReached");

      // qualquer nova compra é bloqueada
      await fails(env, [await buyIx(E4, bob, USDC, U(10))], [bob], "HardCapExceeded", bob);

      // elasticidade: após resgate/queima, a capacidade volta a existir
      await ok(env, [await sellIx(E4, alice, USDC, 1_000_000n * 100n)], [alice], alice);
      const s2 = await state(E4);
      assert.equal(s2.ref, cap - 1_000_000n * 100n);
      await ok(env, [await buyIx(E4, bob, USDC, U(10))], [bob], bob);
      assert.ok((await state(E4)).ref <= cap);
    });
  });

  // ================================================================== Resgates
  describe("sell_tokens", () => {
    it("11. resgate em USDC: queima tokens, reduz supply, paga líquido e registra taxa", async () => {
      const s = await state(E1);
      const tokens = T6(5_000);
      const q = quoteSell("usdc", tokens, s.sol, s.usdc, s.ref);
      const bobTok = await tokenAccountFor(E1, bob);
      const bobUsdc = usdcOf.get(bob.publicKey.toBase58())!;
      const [t0, u0, r0, supply0] = [
        await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID),
        await tokenBalance(env, bobUsdc),
        await tokenBalance(env, revenueUsdc),
        (await mintInfo(env, E1.mint)).supply,
      ];
      const logs = await ok(env, [await sellIx(E1, bob, USDC, tokens, { minOut: q.net })], [bob], bob);

      assert.equal(t0 - (await tokenBalance(env, bobTok, TOKEN_2022_PROGRAM_ID)), tokens);
      assert.equal(supply0 - (await mintInfo(env, E1.mint)).supply, tokens); // queimados de fato
      assert.equal((await tokenBalance(env, bobUsdc)) - u0, q.net);
      assert.equal((await tokenBalance(env, revenueUsdc)) - r0, q.fee);
      assert.equal(q.fee, fee(q.gross));
      const a = await state(E1);
      assert.equal(s.circ - a.circ, tokens);
      assert.equal(s.usdc - a.usdc, q.gross);
      assert.equal(big(a.v.totalBurned), tokens);
      const evs = parseEvents(env, logs);
      assert.ok(evs.some((e) => e.name.toLowerCase() === "tokenredeemed"));
      assert.equal(evs.filter((e) => e.name.toLowerCase() === "platformfeecollected").length, 1);
    });

    it("11b. resgate em SOL paga do cofre SOL com a mesma regra", async () => {
      const s = await state(E1);
      const tokens = T6(1_000);
      const q = quoteSell("sol", tokens, s.sol, s.usdc, s.ref);
      const r0 = await lamports(env, revenue.publicKey);
      const t0 = await lamports(env, E1.solTreasury);
      await ok(env, [await sellIx(E1, alice, SOL, tokens)], [alice], alice);
      assert.equal(t0 - (await lamports(env, E1.solTreasury)), q.gross);
      assert.equal((await lamports(env, revenue.publicKey)) - r0, q.fee);
      const a = await state(E1);
      assert.equal(s.sol - a.sol, q.gross);
    });

    it("20. saldo insuficiente para resgate: nunca libera mais que o lastro do ativo", async () => {
      // Mallory recebeu ~1,98M tokens (≈ US$ 19,8 mil); o cofre SOL tem ~2 SOL contabilizados.
      const s = await state(E1);
      const malloryTok = await tokenAccountFor(E1, mallory);
      const bal = await tokenBalance(env, malloryTok, TOKEN_2022_PROGRAM_ID);
      const q = quoteSell("sol", bal, s.sol, s.usdc, s.ref);
      assert.ok(q.gross > s.sol);
      await fails(env, [await sellIx(E1, mallory, SOL, bal, { noRecord: true })], [mallory], "InsufficientLiquidity", mallory);
      // vender mais tokens do que possui
      await fails(env, [await sellIx(E1, mallory, USDC, bal + 1n, { noRecord: true })], [mallory], "InsufficientUserBalance", mallory);
      // o mesmo resgate em USDC (onde há lastro) funciona; slippage protege o usuário
      const qu = quoteSell("usdc", bal, s.sol, s.usdc, s.ref);
      await fails(env, [await sellIx(E1, mallory, USDC, bal, { noRecord: true, minOut: qu.net + 1n })], [mallory], "SlippageExceeded", mallory);
      await ok(env, [await sellIx(E1, mallory, USDC, bal, { noRecord: true, minOut: qu.net })], [mallory], mallory);
      const a = await state(E1);
      assert.ok((await tokenBalance(env, E1.usdcTreasury)) >= a.usdc);
    });
  });

  // ================================================================== Lucro
  describe("inject_daily_profit", () => {
    it("12+13. injeta lucro sem cunhar e aumenta o lastro por token", async () => {
      const s = await state(E1);
      const supply0 = (await mintInfo(env, E1.mint)).supply;
      const holderTokens = T6(1_000);
      const quote0 = quoteSell("usdc", holderTokens, s.sol, s.usdc, s.ref);

      const amount = U(25_000);
      const logs = await ok(env, [await injectIx(E1, injector, USDC, amount, 20261115)], [injector], injector);
      const a = await state(E1);
      // sem cunhagem e sem alteração de supply
      assert.equal((await mintInfo(env, E1.mint)).supply, supply0);
      assert.equal(a.circ, s.circ);
      assert.equal(a.locked, s.locked);
      // lastro aumentou exatamente o valor injetado (cofre sem taxa em injeções)
      assert.equal(a.usdc - s.usdc, amount);
      assert.equal(big(a.l.usdcProfitInjected), amount);
      // lastro por token subiu: o mesmo lote de tokens resgata mais
      const quote1 = quoteSell("usdc", holderTokens, a.sol, a.usdc, a.ref);
      assert.ok(quote1.gross > quote0.gross);
      assert.ok(a.usdc * s.ref > s.usdc * a.ref);

      const receipt = await program.account.profitReceipt.fetch(profitPda(E1.vault, bn(20261115)));
      assert.equal(receipt.origin, "PDV-LOJA-01");
      assert.equal(big(receipt.netAmount), amount);
      assert.ok(receipt.injector.equals(injector.publicKey));
      assert.ok(big(receipt.timestamp) > 0n);
      const ev = parseEvents(env, logs).find((e) => e.name.toLowerCase() === "profitinjected")!;
      assert.ok(ev);
      assert.equal(ev.data.entityId.toString(), "1");

      // injeção em SOL também funciona, fora de qualquer restrição de horário
      await ok(env, [await injectIx(E1, injector, SOL, BigInt(2 * LAMPORTS_PER_SOL), 20261116)], [injector], injector);
      assert.equal((await state(E1)).sol - a.sol, BigInt(2 * LAMPORTS_PER_SOL));
    });

    it("[ataque] repasse duplicado (mesmo reference_id) e remetente não autorizado são rejeitados", async () => {
      await fails(env, [await injectIx(E1, injector, USDC, U(25_000), 20261115)], [injector], "already in use", injector);
      await fails(env, [await injectIx(E1, mallory, USDC, U(10), 777)], [mallory], "Unauthorized", mallory);
      await fails(env, [await injectIx(E1, injector, USDC, 0n, 778)], [injector], "InvalidAmount", injector);
    });

    it("taxa opcional sobre injeções (charge_fee_on_profit) é cobrada uma única vez", async () => {
      await ok(env, [
        await program.methods
          .updateEntityConfig({ minBuy: null, maxBuy: null, maxWallet: null, platformFeeBps: null, profitInjector: null, chargeFeeOnProfit: true })
          .accountsStrict({ admin: env.admin.publicKey, config, vault: E2.vault, newRevenueWallet: null })
          .instruction(),
      ]);
      const s = await state(E2);
      const r0 = await tokenBalance(env, revenueUsdc);
      await ok(env, [await injectIx(E2, injector, USDC, U(1_000), 1)], [injector], injector);
      const a = await state(E2);
      assert.equal((await tokenBalance(env, revenueUsdc)) - r0, U(11.9));
      assert.equal(a.usdc - s.usdc, U(988.1));
    });
  });

  // ================================================================== Vesting
  describe("Vesting de 30% (carência de 180 dias, 24 meses totais)", () => {
    let verumTok: PublicKey;
    let start: bigint;
    let cliff: bigint;
    let end: bigint;
    let total: bigint;

    before(async () => {
      verumTok = await createTokenAccount(env, E1.mint, verum[1].publicKey, TOKEN_2022_PROGRAM_ID);
      const v = await program.account.vestingAccount.fetch(E1.vesting);
      start = big(v.startTs);
      cliff = big(v.cliffTs);
      end = big(v.endTs);
      total = big(v.totalAllocated);
      assert.equal(total, 7_500_000n * 10n ** 6n);
    });

    it("14. impede saque antes dos 180 dias", async () => {
      await fails(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], "VestingCliffNotReached", verum[1]);
      await warpTo(env, cliff - 1n);
      await fails(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], "VestingCliffNotReached", verum[1]);
      assert.equal(await tokenBalance(env, verumTok, TOKEN_2022_PROGRAM_ID), 0n);
    });

    it("15. libera linearmente após a carência, somente para a Verum Wallet", async () => {
      // 55 dias após a carência = 10% do período linear de 550 dias
      await warpTo(env, cliff + 55n * DAY);
      const s = await state(E1);
      const logs = await ok(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], verum[1]);
      assert.equal(await tokenBalance(env, verumTok, TOKEN_2022_PROGRAM_ID), total / 10n);
      const v = await program.account.vestingAccount.fetch(E1.vesting);
      assert.equal(big(v.released), total / 10n);
      assert.equal(big(v.remaining), total - total / 10n);
      const a = await state(E1);
      // bloqueado -> circulante; supply de referência não muda (sem diluição)
      assert.equal(s.locked - a.locked, total / 10n);
      assert.equal(a.circ - s.circ, total / 10n);
      assert.equal(a.ref, s.ref);
      const ev = parseEvents(env, logs).find((e) => e.name.toLowerCase() === "vestedtokensclaimed")!;
      assert.equal(ev.data.amount.toString(), (total / 10n).toString());
    });

    it("17. impede saque duplicado no mesmo instante", async () => {
      await fails(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], "NothingToClaim", verum[1]);
    });

    it("16. impede saque para carteira não autorizada", async () => {
      await warpTo(env, cliff + 110n * DAY);
      const malloryTok = await tokenAccountFor(E1, mallory);
      // Verum assina, mas o destino pertence a outra carteira
      await fails(env, [await claimIx(E1, verum[1].publicKey, malloryTok)], [verum[1]], "ConstraintTokenOwner", verum[1]);
      // atacante assina como beneficiário
      await fails(env, [await claimIx(E1, mallory.publicKey, malloryTok)], [mallory], "Unauthorized", mallory);
      // Verum Wallet de OUTRA entidade tenta sacar o vesting da entidade 1
      const otherTok = await createTokenAccount(env, E1.mint, verum[2].publicKey, TOKEN_2022_PROGRAM_ID);
      await fails(env, [await claimIx(E1, verum[2].publicKey, otherTok)], [verum[2]], "Unauthorized", verum[2]);
      assert.equal(await tokenBalance(env, malloryTok, TOKEN_2022_PROGRAM_ID), 0n);
    });

    it("libera 100% ao final dos 24 meses e nada além disso", async () => {
      await warpTo(env, end + 1n);
      await ok(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], verum[1]);
      assert.equal(await tokenBalance(env, verumTok, TOKEN_2022_PROGRAM_ID), total);
      assert.equal(await tokenBalance(env, E1.vestingEscrow, TOKEN_2022_PROGRAM_ID), 0n);
      const v = await program.account.vestingAccount.fetch(E1.vesting);
      assert.equal(big(v.released), total);
      assert.equal(big(v.remaining), 0n);
      assert.equal((await state(E1)).locked, 0n);
      await warpTo(env, end + 400n * DAY);
      await fails(env, [await claimIx(E1, verum[1].publicKey, verumTok)], [verum[1]], "NothingToClaim", verum[1]);
      assert.equal(end - start, 730n * DAY);
      await refreshPrices(env);
    });

    it("tokens liberados são resgatáveis pelo lastro (vesting sempre esteve lastreado)", async () => {
      const key = `1:${verum[1].publicKey.toBase58()}`;
      tokOf.set(key, verumTok);
      usdcOf.set(verum[1].publicKey.toBase58(), await createTokenAccount(env, usdcMint, verum[1].publicKey));
      const s = await state(E1);
      const q = quoteSell("usdc", T6(10_000), s.sol, s.usdc, s.ref);
      await ok(env, [await sellIx(E1, verum[1], USDC, T6(10_000), { noRecord: true })], [verum[1]], verum[1]);
      assert.equal(await tokenBalance(env, usdcOf.get(verum[1].publicKey.toBase58())!), q.net);
    });
  });

  // ================================================================== Oráculo
  describe("Oráculo", () => {
    const tryBuy = async (code: string) => fails(env, [await buyIx(E2, alice, USDC, U(100))], [alice], code, alice);

    it("19. falhas de oráculo bloqueiam compras e resgates", async () => {
      const t = await now(env);
      // preço desatualizado (61 s > 60 s)
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { publishTime: t - 61n });
      await tryBuy("StaleOraclePrice");
      // timestamp no futuro
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { publishTime: t + 3600n });
      await tryBuy("StaleOraclePrice");
      // preço zero / negativo
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 0n);
      await tryBuy("InvalidOraclePrice");
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, -5n);
      await tryBuy("InvalidOraclePrice");
      // intervalo de confiança largo demais (2% > 1%)
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { conf: 3_00000000n });
      await tryBuy("OracleConfidenceTooWide");
      // feed errado na conta
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { feedId: USDC_FEED_ID });
      await tryBuy("OracleFeedMismatch");
      // verificação parcial
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { partial: true });
      await tryBuy("OracleNotFullyVerified");
      // conta com dono diferente do programa de oráculo configurado
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { owner: Keypair.generate().publicKey });
      await tryBuy("InvalidOracleAccount");
      // discriminador incorreto
      await setPrice(env, env.solPriceFeed, SOL_FEED_ID, 150_00000000n, { discriminator: Buffer.alloc(8, 7) });
      await tryBuy("InvalidOracleAccount");
      // falha também no feed de USDC e também bloqueia resgates
      await refreshPrices(env);
      await setPrice(env, env.usdcPriceFeed, USDC_FEED_ID, 1_00000000n, { publishTime: t - 1000n });
      await tryBuy("StaleOraclePrice");
      await fails(env, [await sellIx(E1, bob, USDC, T6(10))], [bob], "StaleOraclePrice", bob);
      await refreshPrices(env);
    });

    it("[ataque] conta de preço forjada (endereço diferente do fixado) é rejeitada", async () => {
      const forged = Keypair.generate().publicKey;
      // mesmo dono, mesmo feed, preço manipulado: SOL a US$ 1 milhão
      await setPrice(env, forged, SOL_FEED_ID, 1_000_000_00000000n);
      await fails(env, [await buyIx(E2, alice, SOL, BigInt(LAMPORTS_PER_SOL), { solPriceFeed: forged })], [alice], "InvalidOracleAccount", alice);
      // trocar os feeds de lugar
      await fails(
        env,
        [await buyIx(E2, alice, SOL, BigInt(LAMPORTS_PER_SOL), { solPriceFeed: env.usdcPriceFeed, usdcPriceFeed: env.solPriceFeed })],
        [alice],
        "InvalidOracleAccount",
        alice
      );
    });

    it("variação de preço do SOL reprecifica o lastro em unidade comum (USD)", async () => {
      // entidade 2: 9 decimais, lastro apenas em USDC até aqui
      await ok(env, [await buyIx(E2, alice, SOL, BigInt(10 * LAMPORTS_PER_SOL))], [alice], alice);
      const s = await state(E2);
      const lot = 1_000n * 10n ** 9n;
      const at150 = quoteSell("usdc", lot, s.sol, s.usdc, s.ref, P(150), P(1));
      await refreshPrices(env, 300_00000000n, 1_00000000n);
      const at300 = quoteSell("usdc", lot, s.sol, s.usdc, s.ref, P(300), P(1));
      assert.ok(at300.gross > at150.gross);
      const u0 = await tokenBalance(env, usdcOf.get(alice.publicKey.toBase58())!);
      await ok(env, [await sellIx(E2, alice, USDC, lot)], [alice], alice);
      assert.equal((await tokenBalance(env, usdcOf.get(alice.publicKey.toBase58())!)) - u0, at300.net);
      await refreshPrices(env);
    });

    it("emit_vault_snapshot publica NAV, preço e segregação contábil", async () => {
      const logs = await ok(env, [
        await program.methods
          .emitVaultSnapshot()
          .accountsStrict({ config, vault: E1.vault, ledger: E1.ledger, solPriceFeed: env.solPriceFeed, usdcPriceFeed: env.usdcPriceFeed })
          .instruction(),
      ]);
      const ev = parseEvents(env, logs).find((e) => e.name.toLowerCase() === "vaultsnapshot")!;
      assert.ok(ev);
      const s = await state(E1);
      const nav = (s.sol * 150n * 10n ** 9n) / 10n ** 9n + s.usdc * 1000n;
      assert.equal(ev.data.navNanoUsd.toString(), nav.toString());
      assert.equal(
        (BigInt(ev.data.reservedForRedemptionsNanoUsd.toString()) + BigInt(ev.data.vestingBackingNanoUsd.toString())).toString(),
        nav.toString()
      );
    });
  });

  // ================================================================== Admin
  describe("Permissões administrativas e pausa emergencial", () => {
    const pauseIx = (e: EntityPdas, signer: PublicKey, paused: boolean) =>
      program.methods.setVaultPaused(paused).accountsStrict({ admin: signer, config, vault: e.vault }).instruction();

    it("18. acessos administrativos não autorizados são rejeitados", async () => {
      const m = mallory.publicKey;
      const e = entityPdas(66);
      await fails(env, [await initEntityIx(e, { ...entityArgs(1), entityId: bn(66) }, m)], [mallory], "Unauthorized", mallory);
      await fails(env, [await pauseIx(E1, m, true)], [mallory], "Unauthorized", mallory);
      await fails(
        env,
        [
          await program.methods
            .updateEntityConfig({ minBuy: bn(1), maxBuy: null, maxWallet: null, platformFeeBps: 0, profitInjector: m, chargeFeeOnProfit: null })
            .accountsStrict({ admin: m, config, vault: E1.vault, newRevenueWallet: m })
            .instruction(),
        ],
        [mallory],
        "Unauthorized",
        mallory
      );
      await fails(
        env,
        [
          await program.methods
            .updateFactoryConfig({
              oracleProgram: m, solPriceAccount: null, usdcPriceAccount: null, solFeedId: null, usdcFeedId: null,
              maxPriceAgeSecs: null, maxConfBps: null, opsUtcOffsetSecs: null,
            })
            .accountsStrict({ admin: m, config, newRevenueWallet: m })
            .instruction(),
        ],
        [mallory],
        "Unauthorized",
        mallory
      );
      await fails(env, [await program.methods.setFactoryPaused(true).accountsStrict({ admin: m, config }).instruction()], [mallory], "Unauthorized", mallory);
      await fails(env, [await program.methods.proposeAdmin(m).accountsStrict({ admin: m, config }).instruction()], [mallory], "Unauthorized", mallory);
      await fails(env, [await program.methods.acceptAdmin().accountsStrict({ newAdmin: m, config }).instruction()], [mallory], "NoPendingAdmin", mallory);
      await fails(
        env,
        [await program.methods.closeMinting(true).accountsStrict({ admin: m, config, vault: E1.vault, mint: E1.mint, token2022Program: TOKEN_2022_PROGRAM_ID }).instruction()],
        [mallory],
        "Unauthorized",
        mallory
      );
      await fails(
        env,
        [
          await program.methods
            .updateRegistryData({ companyName: "Hack", address: "x", phone: "x", country: "x", directorsNames: "x", payerName: "x" })
            .accountsStrict({ admin: m, config, vault: E1.vault, registry: E1.registry })
            .instruction(),
        ],
        [mallory],
        "Unauthorized",
        mallory
      );
    });

    it("limites de configuração: taxa acima do teto e oráculo fora dos limites são rejeitados", async () => {
      await fails(
        env,
        [
          await program.methods
            .updateEntityConfig({ minBuy: null, maxBuy: null, maxWallet: null, platformFeeBps: 600, profitInjector: null, chargeFeeOnProfit: null })
            .accountsStrict({ admin: env.admin.publicKey, config, vault: E1.vault, newRevenueWallet: null })
            .instruction(),
        ],
        [],
        "InvalidFee"
      );
      await fails(
        env,
        [
          await program.methods
            .updateFactoryConfig({
              oracleProgram: null, solPriceAccount: null, usdcPriceAccount: null, solFeedId: null, usdcFeedId: null,
              maxPriceAgeSecs: bn(86_400), maxConfBps: null, opsUtcOffsetSecs: null,
            })
            .accountsStrict({ admin: env.admin.publicKey, config, newRevenueWallet: null })
            .instruction(),
        ],
        [],
        "InvalidOracleConfig"
      );
    });

    it("pausa emergencial por cofre: bloqueia operações, emite eventos e isola as demais entidades", async () => {
      const logs = await ok(env, [await pauseIx(E1, env.admin.publicKey, true)]);
      assert.ok(parseEvents(env, logs).some((e) => e.name.toLowerCase() === "vaultpaused"));
      await fails(env, [await buyIx(E1, bob, USDC, U(100))], [bob], "VaultNotActive", bob);
      await fails(env, [await sellIx(E1, bob, USDC, T6(10))], [bob], "VaultNotActive", bob);
      await fails(env, [await injectIx(E1, injector, USDC, U(10), 9001)], [injector], "VaultNotActive", injector);
      // outra entidade segue operando normalmente
      await ok(env, [await buyIx(E2, bob, USDC, U(100))], [bob], bob);
      const logs2 = await ok(env, [await pauseIx(E1, env.admin.publicKey, false)]);
      assert.ok(parseEvents(env, logs2).some((e) => e.name.toLowerCase() === "vaultresumed"));
      await ok(env, [await buyIx(E1, bob, USDC, U(100))], [bob], bob);
    });

    it("pausa global da Factory bloqueia todos os cofres", async () => {
      const ix = (p: boolean) => program.methods.setFactoryPaused(p).accountsStrict({ admin: env.admin.publicKey, config }).instruction();
      await ok(env, [await ix(true)]);
      await fails(env, [await buyIx(E1, bob, USDC, U(100))], [bob], "FactoryPaused", bob);
      await fails(env, [await buyIx(E2, bob, USDC, U(100))], [bob], "FactoryPaused", bob);
      await fails(env, [await sellIx(E1, bob, USDC, T6(10))], [bob], "FactoryPaused", bob);
      await ok(env, [await ix(false)]);
      await ok(env, [await buyIx(E2, bob, USDC, U(100))], [bob], bob);
    });

    it("atualização administrativa (anti-whale, cadastro) emite AdministrativeConfigurationUpdated", async () => {
      const logs = await ok(env, [
        await program.methods
          .updateEntityConfig({ minBuy: bn(T6(50)), maxBuy: null, maxWallet: null, platformFeeBps: null, profitInjector: null, chargeFeeOnProfit: null })
          .accountsStrict({ admin: env.admin.publicKey, config, vault: E1.vault, newRevenueWallet: null })
          .instruction(),
      ]);
      assert.ok(parseEvents(env, logs).some((e) => e.name.toLowerCase() === "administrativeconfigurationupdated"));
      assert.equal(big((await vaultOf(E1)).minBuy), T6(50));
      await fails(env, [await buyIx(E1, bob, USDC, U(0.3))], [bob], "BelowMinBuy", bob); // ~29 tokens < 50

      await ok(env, [
        await program.methods
          .updateRegistryData({ companyName: "Empresa 1 Holding S.A.", address: "Nova sede, 200", phone: "+595 61 111 111", country: "Paraguay", directorsNames: "Diretora Dois", payerName: "Novo Pagador" })
          .accountsStrict({ admin: env.admin.publicKey, config, vault: E1.vault, registry: E1.registry })
          .instruction(),
      ]);
      const reg = await program.account.registryData.fetch(E1.registry);
      assert.equal(reg.companyName, "Empresa 1 Holding S.A.");
      assert.equal(reg.updateCount, 1);
    });

    it("transferência de administração em dois passos", async () => {
      const newAdmin = Keypair.generate();
      await fund(env, newAdmin.publicKey, 10);
      await ok(env, [await program.methods.proposeAdmin(newAdmin.publicKey).accountsStrict({ admin: env.admin.publicKey, config }).instruction()]);
      await fails(env, [await program.methods.acceptAdmin().accountsStrict({ newAdmin: mallory.publicKey, config }).instruction()], [mallory], "Unauthorized", mallory);
      await ok(env, [await program.methods.acceptAdmin().accountsStrict({ newAdmin: newAdmin.publicKey, config }).instruction()], [newAdmin], newAdmin);
      // o antigo admin perde os poderes imediatamente
      await fails(env, [await pauseIx(E1, env.admin.publicKey, true)], [], "Unauthorized");
      // devolve a administração para seguir os testes
      await ok(env, [await program.methods.proposeAdmin(env.admin.publicKey).accountsStrict({ admin: newAdmin.publicKey, config }).instruction()], [newAdmin], newAdmin);
      await ok(env, [await program.methods.acceptAdmin().accountsStrict({ newAdmin: env.admin.publicKey, config }).instruction()]);
    });

    it("close_minting revoga a Mint Authority de forma irreversível; resgates continuam", async () => {
      const ix = (confirm: boolean) =>
        program.methods
          .closeMinting(confirm)
          .accountsStrict({ admin: env.admin.publicKey, config, vault: E3.vault, mint: E3.mint, token2022Program: TOKEN_2022_PROGRAM_ID })
          .instruction();
      await ok(env, [await buyIx(E3, bob, USDC, U(100))], [bob], bob); // 0 decimais: 9.881 tokens
      assert.equal(await tokenBalance(env, await tokenAccountFor(E3, bob), TOKEN_2022_PROGRAM_ID), 9_881n);
      await fails(env, [await ix(false)], [], "ConfirmationRequired");
      await ok(env, [await ix(true)]);
      assert.isNull((await mintInfo(env, E3.mint)).mintAuthority);
      await fails(env, [await buyIx(E3, bob, USDC, U(100))], [bob], "MintingClosed", bob);
      await fails(env, [await ix(true)], [], "MintingClosed");
      await ok(env, [await sellIx(E3, bob, USDC, 1_000n)], [bob], bob);
      await ok(env, [await injectIx(E3, injector, USDC, U(100), 5)], [injector], injector);
    });
  });

  // ================================================================== Invariantes
  describe("Invariantes contábeis finais", () => {
    it("cofre totalmente resgatado (supply de referência zero) volta ao preço inicial", async () => {
      const E5 = entityPdas(5);
      const w = verum[4];
      await refreshPrices(env);
      await createEntity(5, E5, { verumWalletAddress: w.publicKey, initialPool: U(75_000) });
      await warpTo(env, (await now(env)) + 731n * DAY);
      await refreshPrices(env);
      const wTok = await createTokenAccount(env, E5.mint, w.publicKey, TOKEN_2022_PROGRAM_ID);
      tokOf.set(`5:${w.publicKey.toBase58()}`, wTok);
      usdcOf.set(w.publicKey.toBase58(), await createTokenAccount(env, usdcMint, w.publicKey));
      await ok(env, [await claimIx(E5, w.publicKey, wTok)], [w], w);
      const total = 7_500_000n * 10n ** 6n;
      assert.equal(await tokenBalance(env, wTok, TOKEN_2022_PROGRAM_ID), total);
      // a entidade resgata 100% do supply: recebe exatamente o lastro (menos a taxa)
      await ok(env, [await sellIx(E5, w, USDC, total, { noRecord: true })], [w], w);
      assert.equal(await tokenBalance(env, usdcOf.get(w.publicKey.toBase58())!), U(75_000) - fee(U(75_000)));
      const s = await state(E5);
      assert.equal(s.ref, 0n);
      assert.equal(s.usdc, 0n);
      assert.equal((await mintInfo(env, E5.mint)).supply, 0n);
      // lucro injetado num cofre sem tokens ficaria sem dono: rejeitado
      await fails(env, [await injectIx(E5, injector, USDC, U(1_000), 55)], [injector], "ZeroReferenceSupply", injector);
      // nova compra é precificada pelo preço inicial (US$ 0,01), sem divisão por zero
      await ok(env, [await buyIx(E5, bob, USDC, U(100))], [bob], bob);
      assert.equal(await tokenBalance(env, await tokenAccountFor(E5, bob), TOKEN_2022_PROGRAM_ID), 9_881_000_000n);
      assert.equal((await state(E5)).usdc, U(98.81));
    });

    it("supply on-chain == circulante + vesting, <= Hard Cap; cofres cobrem o lastro; taxas fora do lastro", async () => {
      for (const e of [E1, E2, E3, E4, entityPdas(5)]) {
        const s = await state(e);
        const m = await mintInfo(env, e.mint);
        assert.equal(m.supply, s.ref, "supply do mint == supply de referência");
        assert.ok(s.ref <= big(s.v.hardCap), "Hard Cap respeitado");
        assert.equal(big(s.v.totalMinted) - big(s.v.totalBurned), s.ref);
        assert.equal(await tokenBalance(env, e.vestingEscrow, TOKEN_2022_PROGRAM_ID), s.locked);
        assert.ok((await tokenBalance(env, e.usdcTreasury)) >= s.usdc, "cofre USDC cobre o lastro contabilizado");
        const rent = (await env.client.getRent()).minimumBalance(0n);
        assert.ok((await lamports(env, e.solTreasury)) - rent >= s.sol, "cofre SOL cobre o lastro contabilizado");
        // lastro = pool inicial + compras + lucro - resgates (taxas nunca entram)
        assert.equal(s.usdc, big(s.v.initialPoolAmount) + big(s.l.usdcBuyInflow) + big(s.l.usdcProfitInjected) - big(s.l.usdcRedeemed));
        assert.equal(s.sol, big(s.l.solBuyInflow) + big(s.l.solProfitInjected) - big(s.l.solRedeemed));
      }
    });
  });
});
