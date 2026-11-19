import { describe, expect, it } from 'vitest';
import { findComplianceViolations, normalizeCategory } from '../src/modules/b2b/compliance.js';
import { ORDER_TRANSITIONS, canTransition } from '../src/modules/p2p/order-status.js';
import { buildPixBrCode, crc16ccitt } from '../src/modules/p2p/payments/brcode.js';
import { WalletService, toChecksumAddress } from '../src/modules/wallet/wallet.service.js';
import { divRound, fromUnits, parseFiatToCents, percentChange, toUnits } from '../src/shared/money.js';
import { EVM_CHECKSUMMED, offCurveSolanaAddress, solanaAddress } from './helpers.js';

describe('money (aritmética exata)', () => {
  it('converte ida e volta sem perda', () => {
    expect(toUnits('0.85', 8)).toBe(85_000_000n);
    expect(fromUnits(85_000_000n, 8)).toBe('0.85000000');
    expect(fromUnits(-5n, 2)).toBe('-0.05');
    expect(toUnits('12.3456789', 2)).toBe(1234n); // trunca
  });
  it('arredonda half-up', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });
  it('calcula variação percentual', () => {
    expect(percentChange('0.81573896', '0.85')).toBe('4.2000');
    expect(percentChange('0.53115424', '0.52')).toBe('-2.1000');
  });
  it('valida entrada em BRL', () => {
    expect(parseFiatToCents(150)).toBe(15000n);
    expect(parseFiatToCents('150,5')).toBe(15050n);
    expect(parseFiatToCents('10.999')).toBeNull();
    expect(parseFiatToCents('1e3')).toBeNull();
    expect(parseFiatToCents(-10)).toBeNull();
    expect(parseFiatToCents(null)).toBeNull();
  });
  it('rejeita decimal malformado', () => {
    expect(() => toUnits('abc', 2)).toThrow();
  });
});

describe('Pix BR Code', () => {
  it('CRC16/CCITT-FALSE confere com o vetor de teste padrão', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
  it('gera payload EMV válido com CRC no final', () => {
    const code = buildPixBrCode({
      pixKey: 'pix-sandbox@casadamoeda.dev',
      merchantName: 'Casa da Moeda Master',
      merchantCity: 'São Paulo',
      amount: '150.00',
      txid: 'CMMDABC123',
    });
    expect(code.startsWith('000201010212')).toBe(true);
    expect(code).toContain('0014br.gov.bcb.pix');
    expect(code).toContain('5406150.00');
    expect(code).toContain('5303986');
    expect(code).toContain('6009SAO PAULO');
    const body = code.slice(0, -4);
    expect(code.slice(-4)).toBe(crc16ccitt(body));
  });
  it('rejeita txid e valor inválidos', () => {
    const base = { pixKey: 'k', merchantName: 'A', merchantCity: 'B', amount: '1.00', txid: 'OK' };
    expect(() => buildPixBrCode({ ...base, txid: 'com-hifen' })).toThrow();
    expect(() => buildPixBrCode({ ...base, amount: '1.5' })).toThrow();
  });
});

describe('Validação de carteira (Verum Wallet)', () => {
  const svc = new WalletService(['solana', 'evm']);

  it('aceita chave pública Solana real', () => {
    const addr = solanaAddress();
    expect(svc.validate(addr)).toEqual({ valid: true, network: 'solana', address: addr });
  });
  it('rejeita PDA (fora da curva Ed25519)', () => {
    expect(() => svc.validate(offCurveSolanaAddress())).toThrow(/programa \(PDA\)/);
  });
  it('rejeita System Program', () => {
    expect(() => svc.validate('11111111111111111111111111111111')).toThrow(/sistema/);
  });
  it('rejeita base58 com tamanho errado', () => {
    expect(() => svc.validate('1'.repeat(10) + '2'.repeat(25))).toThrow();
  });
  it('aceita EVM com checksum correto e normaliza minúsculo', () => {
    expect(svc.validate(EVM_CHECKSUMMED).address).toBe(EVM_CHECKSUMMED);
    expect(svc.validate(EVM_CHECKSUMMED.toLowerCase()).address).toBe(EVM_CHECKSUMMED);
    expect(toChecksumAddress(EVM_CHECKSUMMED.toLowerCase())).toBe(EVM_CHECKSUMMED);
  });
  it('rejeita EVM com checksum errado', () => {
    const bad = EVM_CHECKSUMMED.replace('aAeb', 'AAeb');
    expect(() => svc.validate(bad)).toThrow(/Checksum/);
  });
  it('rejeita endereço nulo EVM', () => {
    expect(() => svc.validate('0x' + '0'.repeat(40))).toThrow(/nulo/);
  });
  it('detecta frase-semente e chave privada', () => {
    expect(() => svc.validate('abandon '.repeat(12))).toThrow(/frase-semente/);
    expect(() => svc.validate('ab'.repeat(32))).toThrow(/chave privada/);
  });
  it('respeita redes habilitadas', () => {
    const onlySolana = new WalletService(['solana']);
    expect(() => onlySolana.validate(EVM_CHECKSUMMED)).toThrow(/não está habilitada/);
  });
});

describe('Normas de utilidade (compliance B2B)', () => {
  it('bloqueia promessas de rendimento', () => {
    expect(findComplianceViolations('Token com lucro garantido para todos')).toContain('promessa de lucro');
    expect(findComplianceViolations('Rende 5% ao mês')).toContain('rentabilidade periódica');
    expect(findComplianceViolations('Pagamos dividendos trimestrais')).toHaveLength(1);
    expect(findComplianceViolations('Investimento sem risco')).not.toHaveLength(0);
  });
  it('aceita propósitos de utilidade', () => {
    expect(findComplianceViolations('Ingresso, consumo no bar e votação da atração; também usado em ações sociais.')).toEqual([]);
  });
  it('normaliza categorias por código ou rótulo', () => {
    expect(normalizeCategory('Festas Sertanejas')).toBe('FESTAS_SERTANEJAS');
    expect(normalizeCategory('Ajuda Humanitária')).toBe('AJUDA_HUMANITARIA');
    expect(normalizeCategory('futebol')).toBe('FUTEBOL');
    expect(normalizeCategory('FEIRAS_CULTURAIS')).toBe('FEIRAS_CULTURAIS');
    expect(normalizeCategory('Cassino')).toBeNull();
  });
});

describe('Máquina de estados da ordem', () => {
  it('permite apenas transições válidas', () => {
    expect(canTransition('PENDING', 'PAID')).toBe(true);
    expect(canTransition('PAID', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
    expect(ORDER_TRANSITIONS.EXPIRED).toEqual([]);
  });
});
