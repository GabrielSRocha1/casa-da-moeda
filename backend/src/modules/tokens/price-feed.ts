import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { tokens } from '../../db/schema.js';
import type { Logger } from '../../shared/logger.js';
import { divRound, fromUnits, percentChange, toUnits } from '../../shared/money.js';

/**
 * Oráculo de preços SIMULADO para desenvolvimento.
 * A cada intervalo aplica um passeio aleatório de até ±0,40% nos tokens nativos
 * e recalcula a variação 24h. Em produção, substitua por uma fonte real
 * (pool de liquidez on-chain, livro de ofertas P2P, etc.).
 */
export class SimulatedPriceFeed {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async tick(): Promise<void> {
    const rows = await this.db.select().from(tokens).where(eq(tokens.type, 'NATIVE'));
    for (const t of rows) {
      const current = toUnits(t.price, 8);
      const bps = BigInt(randomInt(-40, 41)); // -0,40% .. +0,40%
      let next = current + divRound(current * bps, 10_000n);
      if (next < 1n) next = 1n;
      const price = fromUnits(next, 8);
      await this.db
        .update(tokens)
        .set({ price, change24h: percentChange(t.referencePrice24h, price), updatedAt: sql`now()` })
        .where(eq(tokens.id, t.id));
    }
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.error({ err }, 'Falha ao atualizar preços'));
    }, intervalMs);
    this.timer.unref();
    this.logger.info({ intervalMs }, 'Oráculo de preços simulado ativo');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
