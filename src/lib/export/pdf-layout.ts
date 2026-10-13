/**
 * A small page-layout helper over pdf-lib for the spec sheet: a cursor that
 * moves down the page, text that wraps or shortens to fit, tables that break
 * across pages with their header repeated, images, and a footer on every
 * page. Text uses the standard fonts (WinAnsi); see `pdfSafe`.
 */
import { rgb, type Color, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { MARGIN_PT } from './paper';

export const BODY = 10;
export const SMALL = 8;
export const H1 = 18;
export const H2 = 13;
/** Line height for body text. */
export const LINE = 14;
/** Space kept for the footer above the bottom margin. */
const FOOTER_PT = 20;
const PAD = 4;
const INK = rgb(0.07, 0.09, 0.15);
export const GREY = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.8, 0.82, 0.85);

export interface Column {
  header: string;
  /** Fraction of the content width. */
  width: number;
  align?: 'left' | 'right';
}

/** Text the standard fonts can draw: odd spaces and line breaks become spaces, anything WinAnsi can't encode becomes "?". */
export function pdfSafe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\r\n\t]/g, ' ').replace(/\u2194/g, '-').replace(/\u2192/g, '->')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** `text`, shortened with an ellipsis if it is wider than `maxW` at `size`. */
export function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** `text` broken at spaces into lines no wider than `maxW`; a single word that is too wide is shortened. */
export function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= maxW) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.map((l) => fit(font, l, size, maxW));
}

export class Sheet {
  page!: PDFPage;
  /** Cursor: the top of the next line, in points from the page's top edge. */
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    readonly size: readonly [number, number],
    private readonly font: PDFFont,
    private readonly bold: PDFFont
  ) {
    this.newPage();
  }

  /** Content width between the margins. */
  get width(): number {
    return this.size[0] - 2 * MARGIN_PT;
  }
  /** The lowest the content may reach (the footer sits below). */
  get bottom(): number {
    return this.size[1] - MARGIN_PT - FOOTER_PT;
  }
  get remaining(): number {
    return this.bottom - this.y;
  }

  newPage(): void {
    this.page = this.doc.addPage([this.size[0], this.size[1]]);
    this.y = MARGIN_PT;
  }

  ensureSpace(h: number): void {
    if (this.y + h > this.bottom) this.newPage();
  }

  gap(h: number): void {
    this.y += h;
  }

  /** Draw already-safe text with its top at the cursor (not moving it). */
  private draw(text: string, x: number, size: number, font: PDFFont, color: Color = INK): void {
    this.page.drawText(text, { x, y: this.size[1] - this.y - size, size, font, color });
  }

  /** One line of text across the content width, shortened if it doesn't fit. */
  line(text: string, o: { size?: number; bold?: boolean; color?: Color } = {}): void {
    const size = o.size ?? BODY;
    const font = o.bold ? this.bold : this.font;
    const height = size * 1.4;
    this.ensureSpace(height);
    this.draw(fit(font, pdfSafe(font, text), size, this.width), MARGIN_PT, size, font, o.color);
    this.y += height;
  }

  /** "Label   value" rows: bold labels, values in a column 110 pt in. */
  keyValues(rows: [string, string][]): void {
    for (const [key, value] of rows) {
      this.ensureSpace(LINE);
      this.draw(fit(this.bold, pdfSafe(this.bold, key), BODY, 104), MARGIN_PT, BODY, this.bold);
      this.draw(fit(this.font, pdfSafe(this.font, value), BODY, this.width - 110), MARGIN_PT + 110, BODY, this.font);
      this.y += LINE;
    }
  }

  /** A table whose cells wrap; a row that doesn't fit starts a new page under a repeated header row. */
  table(columns: Column[], rows: string[][]): void {
    const widths = columns.map((c) => c.width * this.width);
    const lefts = widths.map((_, i) => MARGIN_PT + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const layout = (cells: string[], font: PDFFont) => {
      const lines = cells.map((c, i) => wrap(font, pdfSafe(font, c), BODY, widths[i] - PAD));
      return { lines, height: Math.max(1, ...lines.map((l) => l.length)) * LINE };
    };
    const paint = ({ lines, height }: ReturnType<typeof layout>, font: PDFFont) => {
      lines.forEach((cellLines, i) =>
        cellLines.forEach((text, k) => {
          const x = columns[i].align === 'right' ? lefts[i] + widths[i] - PAD - font.widthOfTextAtSize(text, BODY) : lefts[i];
          this.page.drawText(text, { x, y: this.size[1] - this.y - k * LINE - BODY, size: BODY, font, color: INK });
        })
      );
      this.y += height;
    };
    const header = () => {
      paint(layout(columns.map((c) => c.header), this.bold), this.bold);
      const y = this.size[1] - this.y + 2;
      this.page.drawLine({ start: { x: MARGIN_PT, y }, end: { x: MARGIN_PT + this.width, y }, thickness: 0.5, color: RULE });
      this.y += 3;
    };

    this.ensureSpace(LINE * 2 + 3);
    header();
    for (const cells of rows) {
      const row = layout(cells, this.font);
      if (this.y + row.height > this.bottom) {
        this.newPage();
        header();
      }
      paint(row, this.font);
    }
  }

  /** Right-aligned "label  value" rows under a table; the last (the total) is bold. */
  totals(rows: [string, string][]): void {
    rows.forEach(([label, value], i) => {
      const font = i === rows.length - 1 ? this.bold : this.font;
      this.ensureSpace(LINE);
      const l = pdfSafe(font, label);
      const v = pdfSafe(font, value);
      this.draw(l, MARGIN_PT + this.width * 0.8 - 8 - font.widthOfTextAtSize(l, BODY), BODY, font);
      this.draw(v, MARGIN_PT + this.width - PAD - font.widthOfTextAtSize(v, BODY), BODY, font);
      this.y += LINE;
    });
  }

  /** A PNG `wPt` × `hPt`, centred across the content width at the cursor. */
  async image(png: Uint8Array, wPt: number, hPt: number): Promise<void> {
    this.ensureSpace(hPt);
    const embedded = await this.doc.embedPng(png);
    this.page.drawImage(embedded, { x: MARGIN_PT + (this.width - wPt) / 2, y: this.size[1] - this.y - hPt, width: wPt, height: hPt });
    this.y += hPt;
  }

  /** "<base> · page i of n" at the foot of every page; call once, after the last page exists. */
  footers(base: string): void {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const pagePart = pdfSafe(this.font, ` · page ${i + 1} of ${pages.length}`);
      const room = this.width - this.font.widthOfTextAtSize(pagePart, SMALL);
      const text = fit(this.font, pdfSafe(this.font, base), SMALL, room) + pagePart;
      p.drawText(text, { x: MARGIN_PT, y: MARGIN_PT / 2, size: SMALL, font: this.font, color: GREY });
    });
  }
}
