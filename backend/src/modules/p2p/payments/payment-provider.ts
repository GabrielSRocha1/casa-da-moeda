import QRCode from 'qrcode';
import { buildPixBrCode } from './brcode.js';

/**
 * Contrato de um provedor de pagamento Pix.
 * Hoje: SimulatedPixProvider. Em produção: implemente esta interface com Asaas,
 * Efí, Mercado Pago, etc., sem alterar o restante do módulo P2P.
 */
export interface PixCharge {
  provider: string;
  simulated: boolean;
  txid: string;
  pixCopyPaste: string;
  expiresAt: Date;
}

export interface CreatePixChargeInput {
  orderId: string;
  txid: string;
  /** Valor em BRL com 2 casas ("150.00"). */
  amount: string;
  expiresAt: Date;
  description: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
}

/** Gera o QR Code (PNG em data URL) a partir do "copia e cola". */
export async function pixQrCodeDataUrl(pixCopyPaste: string): Promise<string> {
  return QRCode.toDataURL(pixCopyPaste, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

/**
 * Provedor SIMULADO: gera um BR Code no formato oficial, porém com chave de sandbox.
 * Nenhum valor real é cobrado. A confirmação chega via PATCH /api/p2p/orders/:id/status.
 */
export class SimulatedPixProvider implements PaymentProvider {
  readonly name = 'SIMULATED_PIX';

  constructor(
    private readonly cfg: { pixKey: string; merchantName: string; merchantCity: string },
  ) {}

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const pixCopyPaste = buildPixBrCode({
      pixKey: this.cfg.pixKey,
      merchantName: this.cfg.merchantName,
      merchantCity: this.cfg.merchantCity,
      amount: input.amount,
      txid: input.txid,
      description: input.description,
    });
    return { provider: this.name, simulated: true, txid: input.txid, pixCopyPaste, expiresAt: input.expiresAt };
  }
}
