/** The estimate as CSV (RFC 4180, CRLF line ends) for a spreadsheet or a quote request. */

import type { Estimate } from './estimate';

/** Quote a field when it needs it; defuse text a spreadsheet would run as a formula. */
function field(text: string): string {
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) || safe !== text ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const money = (n: number) => n.toFixed(2);
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

export function estimateToCsv(e: Estimate): string {
  const rows = [
    `# Currency: ${e.currency}`,
    'Item,Quantity,Unit,Unit price,Total',
    ...e.lines.map((l) => [field(l.label), String(l.quantity), l.unit, money(l.unitPrice), money(l.total)].join(',')),
    `Subtotal,,,,${money(e.subtotal)}`,
    `Installation (${pct(e.installPct)}),,,,${money(e.install)}`,
    `Tax (${pct(e.taxPct)}),,,,${money(e.tax)}`,
    `Total,,,,${money(e.total)}`,
  ];
  return rows.join('\r\n') + '\r\n';
}
