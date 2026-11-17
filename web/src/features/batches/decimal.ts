/** Minimal exact decimal arithmetic on BigInt (no floats). value = n / 10^s */
export interface Dec {
  n: bigint;
  s: number;
}

export const ZERO: Dec = { n: 0n, s: 0 };

const RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** Parses a plain decimal string such as "12", "0.5", "-3.25". Throws on anything else. */
export function parseDec(input: string): Dec {
  const m = RE.exec(input.trim());
  if (!m || (!m[2] && !m[3])) throw new Error(`invalid decimal: ${input}`);
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2] || '0'}${frac}`);
  return { n: m[1] === '-' ? -n : n, s: frac.length };
}

/** Parses, returning ZERO for unparseable input (display paths must not crash on odd data). */
export function parseDecSafe(input: string | undefined | null): Dec {
  try {
    return parseDec(input ?? '');
  } catch {
    return ZERO;
  }
}

const pow10 = (k: number) => 10n ** BigInt(k);

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return { n: x + y, s };
}

export function mul(a: Dec, b: Dec): Dec {
  return { n: a.n * b.n, s: a.s + b.s };
}

export function mulInt(a: Dec, k: number): Dec {
  return { n: a.n * BigInt(k), s: a.s };
}

/** Fixed-point string with exactly `dp` decimals, rounding half away from zero. */
export function toFixed(a: Dec, dp: number): string {
  let n = a.n;
  if (a.s <= dp) n *= pow10(dp - a.s);
  else {
    const q = pow10(a.s - dp);
    const abs = n < 0n ? -n : n;
    let r = abs / q;
    if ((abs % q) * 2n >= q) r += 1n;
    n = n < 0n ? -r : r;
  }
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(dp + 1, '0');
  const body = dp === 0 ? digits : `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
  return neg && n !== 0n ? `-${body}` : body;
}

/** Exact value with trailing zeros trimmed but at least 2 decimals, for display. */
export function format(a: Dec): string {
  const exact = toFixed(a, a.s);
  const [i, f = ''] = exact.split('.');
  const trimmed = f.replace(/0+$/, '').padEnd(2, '0');
  return `${i}.${trimmed}`;
}
