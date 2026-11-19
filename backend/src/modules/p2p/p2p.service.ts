import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { p2pOrderEvents, p2pOrders, type OrderStatus, type P2POrder, type P2POrderEvent } from '../../db/schema.js';
import { AppError, badGateway, badRequest, conflict, notFound } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { divFloor, divRound, fromUnits, toUnits } from '../../shared/money.js';
import type { TokensService } from '../tokens/tokens.service.js';
import type { WalletService } from '../wallet/wallet.service.js';
import type { TokenDispatcher } from './custody/token-dispatcher.js';
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS, canTransition, type WebhookStatus } from './order-status.js';
import { pixQrCodeDataUrl, type PaymentProvider } from './payments/payment-provider.js';

type EventSource = 'api' | 'webhook' | 'system';

export interface CreateOrderInput {
  assetSymbol: string;
  fiatCents: bigint;
  userWalletAddress: string;
  idempotencyKey?: string;
}

export interface UpdateStatusInput {
  status: WebhookStatus;
  paymentReference?: string;
  note?: string;
}

export interface OrderDTO {
  id: string;
  status: OrderStatus;
  statusLabel: string;
  assetSymbol: string;
  fiatAmount: string;
  feeAmount: string;
  netFiatAmount: string;
  unitPrice: string;
  tokenAmount: string;
  userWalletAddress: string;
  walletNetwork: string;
  payment: {
    provider: string;
    txid: string;
    simulated: boolean;
    expiresAt: string;
    paidAt: string | null;
    reference: string | null;
    /** Só presente enquanto a ordem está PENDING. */
    pixCopyPaste?: string;
    qrCodeDataUrl?: string;
  };
  custody: { txHash: string; network: string; completedAt: string } | null;
  allowedNextStatuses: OrderStatus[];
  timeline: { from: OrderStatus | null; to: OrderStatus; label: string; source: string; note: string | null; at: string }[];
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class P2PService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly tokens: TokensService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentProvider,
    private readonly dispatcher: TokenDispatcher,
    private readonly logger: Logger,
  ) {}

  // ------------------------------------------------------------------ Cotação
  /** Calcula taxa e quantidade de tokens com aritmética exata. */
  quote(fiatCents: bigint, price: string) {
    const feeCents = divRound(fiatCents * BigInt(this.env.P2P_FEE_BPS), 10_000n);
    const netCents = fiatCents - feeCents;
    const priceUnits = toUnits(price, 8);
    // quantidade = (net / 100) / (price / 1e8), na escala 1e8, arredondando PARA BAIXO
    const tokenUnits = divFloor(netCents * 10n ** 14n, priceUnits);
    return {
      fiatAmount: fromUnits(fiatCents, 2),
      feeAmount: fromUnits(feeCents, 2),
      netFiatAmount: fromUnits(netCents, 2),
      unitPrice: fromUnits(priceUnits, 8),
      tokenAmount: fromUnits(tokenUnits, 8),
      tokenUnits,
    };
  }

  // ------------------------------------------------------------------ Criar ordem
  async createOrder(input: CreateOrderInput): Promise<{ order: OrderDTO; created: boolean }> {
    const wallet = this.wallet.assertValid(input.userWalletAddress, 'userWalletAddress');

    const minCents = toUnits(this.env.P2P_MIN_FIAT.toFixed(2), 2);
    const maxCents = toUnits(this.env.P2P_MAX_FIAT.toFixed(2), 2);
    if (input.fiatCents < minCents || input.fiatCents > maxCents) {
      throw badRequest('FIAT_AMOUNT_OUT_OF_RANGE', `O valor deve estar entre R$ ${fromUnits(minCents, 2)} e R$ ${fromUnits(maxCents, 2)}.`, [
        { field: 'fiatAmount', message: 'Fora do limite permitido por ordem.' },
      ]);
    }

    // Idempotência: mesma chave + mesmos dados = mesma ordem (sem duplicar cobrança).
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return { order: await this.reuseIdempotent(existing, input, wallet.address), created: false };
    }

    const token = await this.tokens.getTradable(input.assetSymbol);
    const q = this.quote(input.fiatCents, token.price);
    if (q.tokenUnits <= 0n) throw badRequest('TOKEN_AMOUNT_TOO_SMALL', 'Valor insuficiente para comprar uma fração do token.');

    const id = randomUUID();
    const txid = ('CMMD' + id.replace(/-/g, '')).slice(0, 25).toUpperCase();
    const expiresAt = new Date(Date.now() + this.env.ORDER_TTL_MINUTES * 60_000);
    const charge = await this.payments.createPixCharge({
      orderId: id,
      txid,
      amount: q.fiatAmount,
      expiresAt,
      description: `Ordem ${token.symbol}`,
    });

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(p2pOrders).values({
          id,
          assetSymbol: token.symbol,
          fiatAmount: q.fiatAmount,
          feeAmount: q.feeAmount,
          unitPrice: q.unitPrice,
          tokenAmount: q.tokenAmount,
          userWalletAddress: wallet.address,
          walletNetwork: wallet.network,
          status: 'PENDING',
          paymentProvider: charge.provider,
          paymentTxid: charge.txid,
          pixPayload: charge.pixCopyPaste,
          expiresAt: charge.expiresAt,
          idempotencyKey: input.idempotencyKey ?? null,
        });
        await tx.insert(p2pOrderEvents).values({ orderId: id, fromStatus: null, toStatus: 'PENDING', source: 'api', note: 'Ordem criada' });
      });
    } catch (err) {
      // Duas requisições simultâneas com a mesma Idempotency-Key: devolve a que venceu.
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return { order: await this.reuseIdempotent(existing, input, wallet.address), created: false };
      }
      throw err;
    }

    this.logger.info({ orderId: id, asset: token.symbol, fiat: q.fiatAmount }, 'Ordem P2P criada');
    return { order: await this.getOrder(id, { withQrCode: true }), created: true };
  }

  // ------------------------------------------------------------------ Consultar
  async getOrder(id: string, opts: { withQrCode?: boolean } = {}): Promise<OrderDTO> {
    const order = await this.expireIfDue(await this.loadOrThrow(id));
    const events = await this.db
      .select()
      .from(p2pOrderEvents)
      .where(eq(p2pOrderEvents.orderId, order.id))
      .orderBy(asc(p2pOrderEvents.createdAt), asc(p2pOrderEvents.id));
    return this.toDTO(order, events, opts.withQrCode ?? true);
  }

  // ------------------------------------------------------------------ Atualizar status (webhook)
  async updateStatus(id: string, input: UpdateStatusInput, source: EventSource = 'webhook'): Promise<{ order: OrderDTO; changed: boolean }> {
    const current = await this.expireIfDue(await this.loadOrThrow(id));

    // Webhooks podem ser reenviados: mesmo status = sucesso idempotente.
    if (current.status === input.status) return { order: await this.getOrder(id), changed: false };

    if (current.status === 'EXPIRED' && input.status === 'PAID') {
      throw conflict('ORDER_EXPIRED', 'A cobrança Pix desta ordem expirou. Crie uma nova ordem.', { status: current.status });
    }
    if (!canTransition(current.status, input.status)) {
      throw conflict('INVALID_STATUS_TRANSITION', `Não é possível mudar a ordem de ${current.status} para ${input.status}.`, {
        from: current.status,
        to: input.status,
        allowed: ORDER_TRANSITIONS[current.status],
      });
    }

    let changed = false;
    await this.db.transaction(async (tx) => {
      // Trava a linha: impede envio duplicado de tokens em webhooks concorrentes.
      const [locked] = await tx.select().from(p2pOrders).where(eq(p2pOrders.id, id)).for('update');
      if (!locked) throw notFound('ORDER_NOT_FOUND', 'Ordem não encontrada.');
      if (locked.status === input.status) return; // outro processo já aplicou
      if (!canTransition(locked.status, input.status)) {
        throw conflict('INVALID_STATUS_TRANSITION', `Não é possível mudar a ordem de ${locked.status} para ${input.status}.`, {
          from: locked.status,
          to: input.status,
          allowed: ORDER_TRANSITIONS[locked.status],
        });
      }

      const patch: Partial<P2POrder> = { status: input.status };
      let note = input.note ?? null;

      if (input.status === 'PAID') {
        patch.paidAt = new Date();
        patch.paymentReference = input.paymentReference ?? null;
        note ??= 'Pagamento Pix confirmado';
      } else if (input.status === 'CANCELLED') {
        patch.cancelledAt = new Date();
        note ??= 'Ordem cancelada';
      } else if (input.status === 'COMPLETED') {
        const result = await this.dispatch(locked);
        patch.custodyTxHash = result.txHash;
        patch.completedAt = new Date();
        note ??= `Tokens enviados para a Verum Wallet (${result.network})${result.simulated ? ' — simulado' : ''}`;
      }

      await tx
        .update(p2pOrders)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(p2pOrders.id, id));
      await tx.insert(p2pOrderEvents).values({ orderId: id, fromStatus: locked.status, toStatus: input.status, source, note });
      changed = true;
    });

    if (changed) this.logger.info({ orderId: id, from: current.status, to: input.status, source }, 'Status da ordem atualizado');

    // Liquidação automática: pagamento confirmado → envia tokens na sequência.
    if (changed && input.status === 'PAID' && this.env.AUTO_SETTLE) {
      return { order: (await this.updateStatus(id, { status: 'COMPLETED' }, 'system')).order, changed: true };
    }
    return { order: await this.getOrder(id), changed };
  }

  // ------------------------------------------------------------------ Internos
  private async dispatch(order: P2POrder) {
    try {
      return await this.dispatcher.send({
        orderId: order.id,
        assetSymbol: order.assetSymbol,
        tokenAmount: order.tokenAmount,
        toAddress: order.userWalletAddress,
        network: order.walletNetwork,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error({ err, orderId: order.id }, 'Falha no envio para auto-custódia');
      throw badGateway('DISPATCH_FAILED', 'Falha ao enviar os tokens para a carteira. A ordem permanece como PAGA; tente novamente.');
    }
  }

  private async loadOrThrow(id: string): Promise<P2POrder> {
    if (!UUID_RE.test(id)) throw badRequest('INVALID_ORDER_ID', 'ID de ordem inválido.');
    const [row] = await this.db.select().from(p2pOrders).where(eq(p2pOrders.id, id)).limit(1);
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Ordem não encontrada.');
    return row;
  }

  private async findByIdempotencyKey(key: string): Promise<P2POrder | undefined> {
    const [row] = await this.db.select().from(p2pOrders).where(eq(p2pOrders.idempotencyKey, key)).limit(1);
    return row;
  }

  private async reuseIdempotent(existing: P2POrder, input: CreateOrderInput, wallet: string): Promise<OrderDTO> {
    const same =
      existing.assetSymbol === input.assetSymbol.trim().toUpperCase() &&
      toUnits(existing.fiatAmount, 2) === input.fiatCents &&
      existing.userWalletAddress === wallet;
    if (!same) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Esta Idempotency-Key já foi usada com dados diferentes.');
    }
    return this.getOrder(existing.id);
  }

  /** Expira ordens PENDING vencidas no momento em que são lidas (lazy expiration). */
  private async expireIfDue(order: P2POrder): Promise<P2POrder> {
    if (order.status !== 'PENDING' || order.expiresAt.getTime() > Date.now()) return order;
    let updated: P2POrder | undefined;
    await this.db.transaction(async (tx) => {
      [updated] = await tx
        .update(p2pOrders)
        .set({ status: 'EXPIRED', updatedAt: sql`now()` })
        .where(sql`${p2pOrders.id} = ${order.id} and ${p2pOrders.status} = 'PENDING'`)
        .returning();
      if (updated) {
        await tx.insert(p2pOrderEvents).values({
          orderId: order.id,
          fromStatus: 'PENDING',
          toStatus: 'EXPIRED',
          source: 'system',
          note: 'Cobrança Pix expirou sem pagamento',
        });
      }
    });
    if (updated) return updated;
    const [fresh] = await this.db.select().from(p2pOrders).where(eq(p2pOrders.id, order.id));
    return fresh ?? order;
  }

  private async toDTO(o: P2POrder, events: P2POrderEvent[], withQrCode: boolean): Promise<OrderDTO> {
    const pending = o.status === 'PENDING';
    const netCents = toUnits(o.fiatAmount, 2) - toUnits(o.feeAmount, 2);
    return {
      id: o.id,
      status: o.status,
      statusLabel: ORDER_STATUS_LABEL[o.status],
      assetSymbol: o.assetSymbol,
      fiatAmount: o.fiatAmount,
      feeAmount: o.feeAmount,
      netFiatAmount: fromUnits(netCents, 2),
      unitPrice: o.unitPrice,
      tokenAmount: o.tokenAmount,
      userWalletAddress: o.userWalletAddress,
      walletNetwork: o.walletNetwork,
      payment: {
        provider: o.paymentProvider,
        txid: o.paymentTxid,
        simulated: o.paymentProvider.startsWith('SIMULATED'),
        expiresAt: o.expiresAt.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
        reference: o.paymentReference,
        ...(pending ? { pixCopyPaste: o.pixPayload } : {}),
        ...(pending && withQrCode ? { qrCodeDataUrl: await pixQrCodeDataUrl(o.pixPayload) } : {}),
      },
      custody:
        o.custodyTxHash && o.completedAt
          ? { txHash: o.custodyTxHash, network: o.walletNetwork, completedAt: o.completedAt.toISOString() }
          : null,
      allowedNextStatuses: ORDER_TRANSITIONS[o.status].filter((s) => s !== 'EXPIRED'),
      timeline: events.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        label: ORDER_STATUS_LABEL[e.toStatus],
        source: e.source,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
