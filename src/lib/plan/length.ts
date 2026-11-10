const MM_PER_IN = 25.4;
const MM_PER_FT = 304.8;

/** A number, or a fraction like 1/2, or a mixed number like 6 1/2. */
const AMOUNT = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\.\d+)`;
const FT = String.raw`(?:'|ft|feet|foot)`;
const IN = String.raw`(?:"|in|inch|inches)`;

function amount(text: string): number | null {
  const parts = text.trim().split(/\s+/);
  let total = 0;
  for (const part of parts) {
    const frac = /^(\d+)\/(\d+)$/.exec(part);
    if (frac) {
      if (Number(frac[2]) === 0) return null;
      total += Number(frac[1]) / Number(frac[2]);
    } else {
      total += Number(part);
    }
  }
  return Number.isFinite(total) ? total : null;
}

/**
 * Read a length the way people write it and return millimetres, or null when
 * it can't be read or isn't positive. A bare number is in the project's units;
 * `3.6 m`, `360 cm`, `3600 mm`, `12' 6"`, `12 ft 6 in`, `150 in` and
 * `12' 6 1/2"` say their own.
 */
export function parseLength(text: string, units: 'mm' | 'in'): number | null {
  const s = text.trim().toLowerCase();
  if (s === '') return null;

  let mm: number | null = null;
  let m: RegExpExecArray | null;

  if ((m = new RegExp(`^${AMOUNT}$`).exec(s))) {
    const n = amount(m[1]);
    mm = n === null ? null : n * (units === 'in' ? MM_PER_IN : 1);
  } else if ((m = new RegExp(`^${AMOUNT}\\s*(mm|cm|m)$`).exec(s))) {
    const n = amount(m[1]);
    mm = n === null ? null : n * { mm: 1, cm: 10, m: 1000 }[m[2] as 'mm' | 'cm' | 'm'];
  } else if ((m = new RegExp(`^${AMOUNT}\\s*${IN}$`).exec(s))) {
    const n = amount(m[1]);
    mm = n === null ? null : n * MM_PER_IN;
  } else if ((m = new RegExp(`^${AMOUNT}\\s*${FT}(?:\\s*${AMOUNT}\\s*${IN}?)?$`).exec(s))) {
    const ft = amount(m[1]);
    const inches = m[2] === undefined ? 0 : amount(m[2]);
    mm = ft === null || inches === null ? null : ft * MM_PER_FT + inches * MM_PER_IN;
  }

  return mm !== null && Number.isFinite(mm) && mm > 0 ? mm : null;
}
