/**
 * Gerador de BR Code Pix (padrão EMV® QRCPS do Banco Central).
 * Produz o "Pix copia e cola" com CRC16 válido.
 */

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — exigido pelo padrão Pix. */
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Campo EMV: ID (2) + tamanho (2) + valor. */
function field(id: string, value: string): string {
  const len = Buffer.byteLength(value, 'utf8');
  if (len > 99) throw new RangeError(`Campo EMV ${id} excede 99 bytes`);
  return id + String(len).padStart(2, '0') + value;
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
function sanitize(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, max);
}

export interface BrCodeInput {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  /** Valor em BRL com 2 casas, ex.: "150.00". */
  amount: string;
  /** Identificador da transação (até 25 caracteres alfanuméricos). */
  txid: string;
  description?: string;
}

export function buildPixBrCode(input: BrCodeInput): string {
  if (!/^[A-Za-z0-9]{1,25}$/.test(input.txid)) throw new RangeError('txid deve ter 1–25 caracteres alfanuméricos');
  if (!/^\d+\.\d{2}$/.test(input.amount)) throw new RangeError('amount deve ter exatamente 2 casas decimais');

  const merchantAccount =
    field('00', 'br.gov.bcb.pix') +
    field('01', input.pixKey) +
    (input.description ? field('02', sanitize(input.description, 40)) : '');

  const payload =
    field('00', '01') + //                          Payload Format Indicator
    field('01', '12') + //                          Point of Initiation: uso único
    field('26', merchantAccount) + //               Merchant Account (Pix)
    field('52', '0000') + //                        Merchant Category Code
    field('53', '986') + //                         Moeda: BRL
    field('54', input.amount) + //                  Valor
    field('58', 'BR') + //                          País
    field('59', sanitize(input.merchantName, 25)) + // Nome do recebedor
    field('60', sanitize(input.merchantCity, 15)) + // Cidade
    field('62', field('05', input.txid)) + //       Additional Data: txid
    '6304'; //                                      CRC (calculado sobre tudo, inclusive "6304")

  return payload + crc16ccitt(payload);
}
