import { describe, expect, it } from 'vitest';
import { toBaseUnits } from '../src/modules/p2p/custody/solana-dispatcher.js';

describe('toBaseUnits', () => {
  it('converte inteiros', () => {
    expect(toBaseUnits('100', 6)).toBe(100_000_000n);
    expect(toBaseUnits('0', 6)).toBe(0n);
  });

  it('converte frações respeitando os decimais do mint', () => {
    expect(toBaseUnits('1.5', 6)).toBe(1_500_000n);
    expect(toBaseUnits('0.000001', 6)).toBe(1n);
    expect(toBaseUnits('12.345678', 6)).toBe(12_345_678n);
  });

  it('trunca precisão além dos decimais (nunca envia a mais)', () => {
    expect(toBaseUnits('1.2345678', 6)).toBe(1_234_567n);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => toBaseUnits('abc', 6)).toThrow();
    expect(() => toBaseUnits('1.2.3', 6)).toThrow();
    expect(() => toBaseUnits('-5', 6)).toThrow();
  });
});
