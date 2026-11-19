/**
 * Cliente JSON-RPC mínimo para uma RPC pública da Solana (sem dependências).
 * Usado para puxar a movimentação on-chain real (transações) e o supply dos
 * tokens nativos (BDC, VRC, ESCT).
 */

export interface SolanaSignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export interface TokenSupply {
  amount: string;
  decimals: number;
  uiAmountString: string;
}

/** Resumo de uma transação que movimentou o token (derivado dos token balances). */
export interface TokenMovement {
  signature: string;
  slot: number;
  /** ISO 8601 ou null quando a RPC não informa o horário do bloco. */
  blockTime: string | null;
  status: 'SUCCESS' | 'FAILED';
  /** Quantidade total do token movimentada (string decimal, casas do mint). */
  amount: string | null;
  /** Carteira de origem (maior saída), quando identificável. */
  from: string | null;
  /** Carteira de destino (maior entrada), quando identificável. */
  to: string | null;
  explorerUrl: string;
}

interface RpcError {
  code: number;
  message: string;
}

interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
  } | null;
}

export class SolanaRpcClient {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`RPC Solana respondeu HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: RpcError };
    if (json.error) throw new Error(`RPC Solana (${method}): ${json.error.message}`);
    return json.result as T;
  }

  async getTokenSupply(mint: string): Promise<TokenSupply> {
    const result = await this.call<{ value: TokenSupply }>('getTokenSupply', [mint]);
    return result.value;
  }

  getSignaturesForAddress(address: string, limit: number): Promise<SolanaSignatureInfo[]> {
    return this.call<SolanaSignatureInfo[]>('getSignaturesForAddress', [address, { limit }]);
  }

  getTransaction(signature: string): Promise<ParsedTransaction | null> {
    return this.call<ParsedTransaction | null>('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
  }

  /**
   * Movimentação recente do token: assinaturas mais novas que tocaram o mint,
   * com valores derivados dos saldos pré/pós-transação (robusto a qualquer
   * programa/DEX, sem depender do formato das instruções).
   */
  async getRecentMovements(mint: string, limit: number): Promise<TokenMovement[]> {
    const signatures = await this.getSignaturesForAddress(mint, limit);
    const movements: TokenMovement[] = [];
    for (const sig of signatures) {
      const base: TokenMovement = {
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
        status: sig.err ? 'FAILED' : 'SUCCESS',
        amount: null,
        from: null,
        to: null,
        explorerUrl: `https://solscan.io/tx/${sig.signature}`,
      };
      try {
        const tx = await this.getTransaction(sig.signature);
        if (tx?.meta) Object.assign(base, summarizeTokenDeltas(tx, mint));
      } catch {
        // Transação indisponível na RPC pública (histórico limitado): mantém só a assinatura.
      }
      movements.push(base);
    }
    return movements;
  }
}

/** Soma os deltas de saldo do mint por dono da conta e resume origem/destino/valor. */
function summarizeTokenDeltas(tx: ParsedTransaction, mint: string): Partial<TokenMovement> {
  const meta = tx.meta;
  if (!meta) return {};
  const decimals = [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])].find((b) => b.mint === mint)
    ?.uiTokenAmount.decimals;
  if (decimals === undefined) return {};

  const byKey = new Map<string, bigint>();
  const add = (balances: ParsedTokenBalance[] | undefined, signFactor: bigint) => {
    for (const b of balances ?? []) {
      if (b.mint !== mint) continue;
      const key = b.owner ?? `#${b.accountIndex}`;
      byKey.set(key, (byKey.get(key) ?? 0n) + signFactor * BigInt(b.uiTokenAmount.amount));
    }
  };
  add(meta.preTokenBalances, -1n);
  add(meta.postTokenBalances, 1n);

  let from: string | null = null;
  let to: string | null = null;
  let maxOut = 0n;
  let maxIn = 0n;
  let moved = 0n;
  for (const [owner, delta] of byKey) {
    if (delta < 0n && -delta > maxOut) { maxOut = -delta; from = owner; }
    if (delta > 0n) {
      moved += delta;
      if (delta > maxIn) { maxIn = delta; to = owner; }
    }
  }
  return { amount: formatUnits(moved, decimals), from, to };
}

function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? '.' + s.slice(s.length - decimals) : '';
  return int + frac;
}
