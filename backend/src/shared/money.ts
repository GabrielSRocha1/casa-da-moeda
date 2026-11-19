/**
 * Aritmética decimal exata com BigInt.
 * Nunca usamos float para dinheiro: 0.1 + 0.2 !== 0.3.
 *
 * Um valor decimal é representado por "unidades" inteiras em uma escala:
 *   "12.34" na escala 2  → 1234n
 *   "0.85"  na escala 8  → 85000000n
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Converte string decimal em unidades inteiras (trunca dígitos além da escala). */
export function toUnits(value: string, scale: number): bigint {
  const v = value.trim();
  if (!DECIMAL_RE.test(v)) throw new TypeError(`Decimal inválido: "${value}"`);
  const negative = v.startsWith('-');
  const [intPart = '0', fracPart = ''] = v.replace('-', '').split('.');
  const frac = fracPart.slice(0, scale).padEnd(scale, '0');
  const units = BigInt(intPart + frac);
  return negative ? -units : units;
}

/** Converte unidades inteiras de volta para string decimal com `scale` casas. */
export function fromUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const abs = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = abs.slice(0, abs.length - scale);
  const fracPart = scale > 0 ? '.' + abs.slice(abs.length - scale) : '';
  return (negative ? '-' : '') + intPart + fracPart;
}

/** Divisão inteira arredondando "meio para longe do zero" (half-up). */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Divisão por zero');
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  return negative ? -q : q;
}

/** Divisão inteira truncando para baixo (usada para quantidade de token: nunca envia a mais). */
export function divFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Divisão por zero');
  return a / b;
}

/** Variação percentual entre dois preços (string com 4 casas). Ex.: ("0.80","0.84") → "5.0000". */
export function percentChange(from: string, to: string): string {
  const f = toUnits(from, 8);
  const t = toUnits(to, 8);
  if (f === 0n) return '0.0000';
  // (t - f) / f * 100, na escala 4
  return fromUnits(divRound((t - f) * 100n * 10_000n, f), 4);
}

const FIAT_INPUT_RE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Valida e converte um valor em BRL vindo da API para centavos.
 * Aceita número (100.5) ou string ("100.50" / "100,50"). Rejeita notação científica,
 * negativos e mais de 2 casas decimais.
 */
export function parseFiatToCents(input: unknown): bigint | null {
  let s: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    s = String(input);
  } else if (typeof input === 'string') {
    s = input.trim().replace(',', '.');
  } else {
    return null;
  }
  if (!FIAT_INPUT_RE.test(s)) return null;
  return toUnits(s, 2);
}
