import { DEFAULT_CURRENCY } from './prices';

/** A currency formatter that never throws: an unknown code falls back to USD. */
export function moneyFormat(currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency });
  } catch {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: DEFAULT_CURRENCY });
  }
}
