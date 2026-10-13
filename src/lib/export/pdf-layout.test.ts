import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fit, pdfSafe, Sheet, wrap } from './pdf-layout';
import { pdfText } from './pdf-text';
import { PAGE } from './paper';

async function sheet() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, sheet: new Sheet(doc, PAGE.a4, font, bold) };
}

describe('pdfSafe', () => {
  it('keeps what WinAnsi can draw and turns the rest into "?"', async () => {
    const { font } = await sheet();
    expect(pdfSafe(font, 'Café — 2 m² · ½')).toBe('Café — 2 m² · ½');
    expect(pdfSafe(font, '厨房 kitchen 🍳')).toBe('?? kitchen ?');
  });

  it('turns odd spaces (as Intl puts in money) and line breaks into spaces', async () => {
    const { font } = await sheet();
    expect(pdfSafe(font, '1\u202f234\u00a0€\nnext')).toBe('1 234 € next');
  });

  it('writes our own arrows as plain text instead of "?"', async () => {
    const { font } = await sheet();
    expect(pdfSafe(font, 'fridge ↔ sink → x')).toBe('fridge - sink -> x');
  });
});

describe('fit and wrap', () => {
  it('shortens text with an ellipsis to fit a width', async () => {
    const { font } = await sheet();
    const long = 'Refrigerator, counter-depth (910 mm)';
    const short = fit(font, long, 10, 60);
    expect(short.endsWith('…')).toBe(true);
    expect(font.widthOfTextAtSize(short, 10)).toBeLessThanOrEqual(60);
    expect(fit(font, 'Sink', 10, 60)).toBe('Sink');
  });

  it('wraps words onto lines that fit', async () => {
    const { font } = await sheet();
    const lines = wrap(font, 'Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm', 10, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toBe('Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm');
  });
});

describe('Sheet', () => {
  it('breaks a long table across pages, repeating the header row', async () => {
    const { doc, sheet: s } = await sheet();
    s.line('Parts list and estimate', { size: 13, bold: true });
    const rows = Array.from({ length: 120 }, (_, i) => [`Part ${i + 1}`, '1', 'each']);
    s.table([{ header: 'Part', width: 0.6 }, { header: 'Qty', width: 0.2, align: 'right' }, { header: 'Unit', width: 0.2 }], rows);
    s.footers('Kitchen · 2026-02-03 · revision 0');
    const text = pdfText(await doc.save());
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(text.filter((t) => t === 'Part')).toHaveLength(doc.getPageCount());
    expect(text).toContain('Part 120');
    expect(text).toContain(`Kitchen · 2026-02-03 · revision 0 · page 1 of ${doc.getPageCount()}`);
  });

  it('keeps the page number in the footer when the name is very long', async () => {
    const { doc, sheet: s } = await sheet();
    s.footers(`${'Long name '.repeat(20)} · 2026-02-03 · revision 0`);
    expect(pdfText(await doc.save()).some((t) => t.endsWith('page 1 of 1'))).toBe(true);
  });

  it('wraps a long cell instead of running past its column', async () => {
    const { doc, sheet: s } = await sheet();
    const detail = 'Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm — every leg within 1200–2700 mm';
    s.table([{ header: 'Rule', width: 0.3 }, { header: 'Detail', width: 0.3 }], [['Work triangle', detail]]);
    const text = pdfText(await doc.save());
    expect(text.filter((t) => detail.includes(t) && t.length > 0).length).toBeGreaterThan(1);
  });

  it('starts a new page when content does not fit', async () => {
    const { doc, sheet: s } = await sheet();
    s.gap(s.remaining - 5);
    s.line('Next');
    expect(doc.getPageCount()).toBe(2);
  });

  it('keeps key–value rows and totals on the page, and draws them', async () => {
    const { doc, sheet: s } = await sheet();
    s.keyValues([['Room', '4200 mm × 3600 mm']]);
    s.totals([['Subtotal', '$100.00'], ['Total', '$130.00']]);
    const text = pdfText(await doc.save());
    expect(text).toEqual(expect.arrayContaining(['Room', '4200 mm × 3600 mm', 'Subtotal', '$100.00', 'Total', '$130.00']));
  });
});
