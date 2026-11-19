import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import bs58 from 'bs58';
import type { WalletNetwork } from '../../db/schema.js';
import { badRequest } from '../../shared/errors.js';

/**
 * Validação estrita de endereços públicos da Verum Wallet (auto-custódia).
 *
 * Solana (rede de origem da Verum Wallet):
 *   - Base58 válido que decodifica para EXATAMENTE 32 bytes.
 *   - A chave precisa estar na curva Ed25519. Endereços fora da curva são PDAs
 *     (contas controladas por programas) — não são carteiras de auto-custódia.
 *   - Bloqueia o System Program / endereço nulo.
 *
 * EVM:
 *   - 0x + 40 hex. Se tiver letras maiúsculas e minúsculas, o checksum EIP-55 precisa bater.
 *   - Bloqueia o endereço nulo (0x000…000). Retorna sempre a forma com checksum.
 *
 * Também detecta quando o usuário cola uma FRASE-SEMENTE por engano.
 */

export interface WalletValidation {
  valid: true;
  network: WalletNetwork;
  address: string; // forma normalizada
}

export type WalletErrorCode =
  | 'WALLET_REQUIRED'
  | 'SEED_PHRASE_DETECTED'
  | 'PRIVATE_KEY_DETECTED'
  | 'WALLET_INVALID_FORMAT'
  | 'WALLET_INVALID_CHECKSUM'
  | 'WALLET_NOT_SELF_CUSTODY'
  | 'WALLET_NETWORK_NOT_ALLOWED';

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const EVM_ZERO = '0x0000000000000000000000000000000000000000';
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

export class WalletValidationError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Converte endereço EVM para o formato com checksum EIP-55. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i] as string;
    out += parseInt(hash[i] as string, 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

function validateSolana(address: string): WalletValidation {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(address);
  } catch {
    throw new WalletValidationError('WALLET_INVALID_FORMAT', 'Endereço Solana com caracteres inválidos.');
  }
  if (bytes.length !== 32) {
    throw new WalletValidationError('WALLET_INVALID_FORMAT', 'Endereço Solana deve representar uma chave pública de 32 bytes.');
  }
  if (address === SOLANA_SYSTEM_PROGRAM || bytes.every((b) => b === 0)) {
    throw new WalletValidationError('WALLET_NOT_SELF_CUSTODY', 'Endereço de sistema não pode receber ativos.');
  }
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
  } catch {
    throw new WalletValidationError(
      'WALLET_NOT_SELF_CUSTODY',
      'Este endereço pertence a um programa (PDA), não a uma carteira de auto-custódia. Use o endereço público da sua Verum Wallet.',
    );
  }
  return { valid: true, network: 'solana', address };
}

function validateEvm(address: string): WalletValidation {
  const body = address.slice(2);
  const isMixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  const checksummed = toChecksumAddress(address);
  if (isMixedCase && checksummed !== address) {
    throw new WalletValidationError('WALLET_INVALID_CHECKSUM', 'Checksum do endereço EVM inválido (EIP-55). Verifique se foi copiado corretamente.');
  }
  if (address.toLowerCase() === EVM_ZERO) {
    throw new WalletValidationError('WALLET_NOT_SELF_CUSTODY', 'O endereço nulo não pode receber ativos.');
  }
  return { valid: true, network: 'evm', address: checksummed };
}

export class WalletService {
  constructor(private readonly allowedNetworks: readonly WalletNetwork[]) {}

  /** Valida e devolve o endereço normalizado. Lança WalletValidationError. */
  validate(raw: unknown): WalletValidation {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new WalletValidationError('WALLET_REQUIRED', 'Informe o endereço público da sua Verum Wallet.');
    }
    const address = raw.trim();

    // Proteção: usuário colou a frase-semente em vez do endereço.
    if (address.split(/\s+/).length >= 12) {
      throw new WalletValidationError(
        'SEED_PHRASE_DETECTED',
        'Isso parece uma frase-semente (seed phrase). NUNCA compartilhe sua seed. Envie apenas o endereço público.',
      );
    }
    // Proteção: chave privada Solana (64 bytes em base58 ≈ 87-88 chars) ou EVM (64 hex).
    if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(address) || /^(0x)?[0-9a-fA-F]{64}$/.test(address)) {
      throw new WalletValidationError(
        'PRIVATE_KEY_DETECTED',
        'Isso parece uma chave privada. NUNCA compartilhe sua chave privada. Envie apenas o endereço público.',
      );
    }

    let result: WalletValidation;
    if (EVM_RE.test(address)) result = validateEvm(address);
    else if (SOLANA_RE.test(address)) result = validateSolana(address);
    else {
      throw new WalletValidationError(
        'WALLET_INVALID_FORMAT',
        'Formato de endereço inválido. Use o endereço público da Verum Wallet (Solana ou EVM 0x…).',
      );
    }

    if (!this.allowedNetworks.includes(result.network)) {
      throw new WalletValidationError(
        'WALLET_NETWORK_NOT_ALLOWED',
        `A rede ${result.network} não está habilitada para recebimento. Redes aceitas: ${this.allowedNetworks.join(', ')}.`,
      );
    }
    return result;
  }

  /** Igual a validate(), mas lança AppError 400 (uso dentro dos outros módulos). */
  assertValid(raw: unknown, field = 'userWalletAddress'): WalletValidation {
    try {
      return this.validate(raw);
    } catch (err) {
      if (err instanceof WalletValidationError) throw badRequest(err.code, err.message, [{ field, message: err.message }]);
      throw err;
    }
  }
}
