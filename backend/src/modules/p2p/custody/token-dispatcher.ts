import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import type { WalletNetwork } from '../../../db/schema.js';

/**
 * Contrato do serviço que envia os tokens para a carteira do usuário (auto-custódia).
 * Em produção: implemente com @solana/web3.js / SPL Token (ou viem para EVM),
 * assinando a partir de uma hot wallet da tesouraria com limites e monitoramento.
 */
export interface DispatchInput {
  orderId: string;
  assetSymbol: string;
  tokenAmount: string;
  toAddress: string;
  network: WalletNetwork;
}

export interface DispatchResult {
  txHash: string;
  network: WalletNetwork;
  simulated: boolean;
}

export interface TokenDispatcher {
  readonly name: string;
  send(input: DispatchInput): Promise<DispatchResult>;
}

/** Dispatcher SIMULADO: devolve uma assinatura/hash no formato da rede, sem transação real. */
export class SimulatedTokenDispatcher implements TokenDispatcher {
  readonly name = 'SIMULATED_DISPATCHER';

  async send(input: DispatchInput): Promise<DispatchResult> {
    const txHash =
      input.network === 'solana'
        ? bs58.encode(randomBytes(64)) // assinatura Solana: 64 bytes em base58
        : '0x' + randomBytes(32).toString('hex'); // hash de transação EVM
    return { txHash, network: input.network, simulated: true };
  }
}
