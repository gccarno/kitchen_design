/**
 * The spec sheet: one design as a PDF to hand to a contractor, cabinet shop
 * or client — the plan (or a closet's front), the wall elevations, the parts
 * list and estimate, and the layout check. Drawings come from the SVG
 * builders, rasterized by sharp at PRINT_DPI and placed at a standard scale.
 * Server-only (sharp is native).
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import type { Catalog } from '../catalog/loader';
import { closetToSvg, DOOR_NAME } from '../closet/svg';
import { buildEstimate, FT2_PER_M2, type Estimate, type EstimateLine } from '../estimate/estimate';
import { moneyFormat } from '../estimate/money';
import { wallElevations } from '../plan/elevation';
import { elevationFrame } from '../plan/elevation-drawing';
import { wallElevationSvg } from '../plan/elevation-svg';
import { polygonAreaMm2, polygonBounds, type Point } from '../plan/geometry';
import { checkAccessibility, checkLayout, layoutDetail, layoutSummary } from '../plan/layout-check';
import { projectKind, type Project } from '../plan/schemas';
import { planToSvg, SVG_SCALE } from '../plan/svg';
import { formatLength } from '../plan/viewport';
import { PAGE, pickScale, PT_MM, svgViewBoxSize } from './paper';
import { GREY, H1, H2, LINE, SMALL, Sheet, type Column } from './pdf-layout';

/** Drawings are rasterized at this resolution for their printed size. */
export const PRINT_DPI = 200;

type Box = { w: number; h: number };

/**
 * Place an SVG drawing in a box at 1:`scale` (or, with no scale, fitted and
 * marked "not to scale"), rasterized at PRINT_DPI, with a caption under it.
 * Our SVGs declare their size at 1:SVG_SCALE, which sets the density.
 */
async function placeDrawing(sheet: Sheet, svg: string, caption: string, box: Box, scale = pickScale(svgViewBoxSize(svg), box)): Promise<void> {
  const real = svgViewBoxSize(svg);
  const k = scale ? 1 / scale : Math.min((box.w * PT_MM) / real.w, (box.h * PT_MM) / real.h);
  const printed = { w: real.w * k, h: real.h * k }; // paper mm
  const density = (PRINT_DPI * printed.w) / (real.w / SVG_SCALE);
  const png = await sharp(Buffer.from(svg), { density }).flatten({ background: '#ffffff' }).png().toBuffer();
  sheet.ensureSpace(printed.h / PT_MM + LINE + 4);
  await sheet.image(png, printed.w / PT_MM, printed.h / PT_MM);
  sheet.gap(4);
  sheet.line(`${caption} — ${scale ? `1:${scale}` : 'not to scale'}`, { size: SMALL, color: GREY });
}

const quantityText = (l: EstimateLine) => (Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2));
const STATUS = { pass: 'Pass', fail: 'Fail', 'n/a': 'n/a' } as const;

const PART_COLUMNS: Column[] = [
  { header: 'Part', width: 0.46 },
  { header: 'Qty', width: 0.1, align: 'right' },
  { header: 'Unit', width: 0.1 },
  { header: 'Unit price', width: 0.17, align: 'right' },
  { header: 'Total', width: 0.17, align: 'right' },
];

function partsPage(sheet: Sheet, estimate: Estimate): void {
  const money = moneyFormat(estimate.currency);
  sheet.newPage();
  sheet.line('Parts list and estimate', { size: H2, bold: true });
  sheet.gap(4);
  sheet.table(
    PART_COLUMNS,
    estimate.lines.map((l) => [l.label, quantityText(l), l.unit, money.format(l.unitPrice), money.format(l.total)])
  );
  sheet.gap(6);
  sheet.totals([
    ['Subtotal', money.format(estimate.subtotal)],
    [`Install (${estimate.installPct}%)`, money.format(estimate.install)],
    [`Tax (${estimate.taxPct}%)`, money.format(estimate.tax)],
    ['Total', money.format(estimate.total)],
  ]);
  sheet.gap(6);
  sheet.line('Prices are estimates from default or edited unit prices, not quotes.', { size: SMALL, color: GREY });
}

function cover(sheet: Sheet, project: Project, subtitle: string, rows: [string, string][]): void {
  sheet.line(project.name, { size: H1, bold: true });
  sheet.line(subtitle, { color: GREY });
  sheet.gap(6);
  sheet.keyValues(rows);
  sheet.gap(10);
}

async function kitchenPages(sheet: Sheet, project: Project, catalog: Catalog, estimate: Estimate): Promise<void> {
  const units = project.units;
  const money = moneyFormat(estimate.currency);
  const poly = project.room.polygon as Point[];
  const b = polygonBounds(poly);
  const areaM2 = polygonAreaMm2(poly) / 1e6;
  const area = units === 'in' ? `${(areaM2 * FT2_PER_M2).toFixed(1)} ft²` : `${areaM2.toFixed(2)} m²`;
  const layout = layoutSummary(checkLayout(project));
  const access = layoutSummary(checkAccessibility(project));

  cover(sheet, project, 'Kitchen spec sheet', [
    ['Room', `${formatLength(b.maxX - b.minX, units)} × ${formatLength(b.maxY - b.minY, units)} · ${area}`],
    ['Items', String(project.items.length)],
    ['Estimate total', money.format(estimate.total)],
    ['Layout check', layout.counted > 0 ? `${layout.passed} of ${layout.counted} passed` : 'nothing to check yet'],
    ['Accessibility', access.counted > 0 ? `${access.passed} of ${access.counted} passed` : 'nothing to check yet'],
  ]);
  const labels = Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId]));
  await placeDrawing(sheet, planToSvg(project, { labels, titleBlock: false }), 'Floor plan', { w: sheet.width, h: sheet.remaining - LINE * 2 });

  const elevations = wallElevations(project, catalog);
  if (elevations.length > 0) {
    sheet.newPage();
    sheet.line('Wall elevations', { size: H2, bold: true });
    sheet.gap(4);
    const frames = elevations.map(elevationFrame);
    // Each wall also spends a gap, its caption line and the gap after it.
    const box = { w: sheet.width, h: sheet.remaining / 3 - (4 + SMALL * 1.4 + 8) };
    const scale = pickScale({ w: Math.max(...frames.map((f) => f.w)), h: Math.max(...frames.map((f) => f.h)) }, box);
    for (const e of elevations) {
      await placeDrawing(sheet, wallElevationSvg(e, units), e.label, box, scale);
      sheet.gap(8);
    }
  }

  partsPage(sheet, estimate);

  sheet.newPage();
  sheet.line(
    layout.counted > 0 ? `Layout check — ${layout.passed} of ${layout.counted} passed` : 'Layout check — place a fridge, sink and range to start',
    { size: H2, bold: true }
  );
  sheet.gap(4);
  sheet.table(
    [{ header: 'Status', width: 0.12 }, { header: 'Rule', width: 0.3 }, { header: 'Detail', width: 0.58 }],
    layout.ordered.map((r) => [r.info && r.status !== 'n/a' ? 'Info' : STATUS[r.status], r.title, layoutDetail(r.detail, units)])
  );
  if (access.ordered.length > 0) {
    sheet.gap(12);
    sheet.line(access.counted > 0 ? `Accessibility — ${access.passed} of ${access.counted} passed` : 'Accessibility — nothing to check yet', { size: H2, bold: true });
    sheet.gap(4);
    sheet.table(
      [{ header: 'Status', width: 0.12 }, { header: 'Rule', width: 0.3 }, { header: 'Detail', width: 0.58 }],
      access.ordered.map((r) => [r.info && r.status !== 'n/a' ? 'Info' : STATUS[r.status], r.title, layoutDetail(r.detail, units)])
    );
  }
}

async function closetPages(sheet: Sheet, project: Project, estimate: Estimate): Promise<void> {
  const closet = project.closet!;
  const units = project.units;
  const { opening } = closet;
  cover(sheet, project, 'Closet spec sheet', [
    ['Interior', `${formatLength(closet.widthMm, units)} × ${formatLength(closet.heightMm, units)} × ${formatLength(closet.depthMm, units)}`],
    ['Door', opening.style === 'open' ? DOOR_NAME.open : `${DOOR_NAME[opening.style]}, ${formatLength(opening.widthMm, units)} wide`],
    ['Components', String(closet.components.length)],
    ['Estimate total', moneyFormat(estimate.currency).format(estimate.total)],
  ]);
  await placeDrawing(sheet, closetToSvg(project, { titleBlock: false }), 'Front elevation', { w: sheet.width, h: sheet.remaining - LINE * 2 });
  partsPage(sheet, estimate);
}

/** One design as a PDF: Letter for projects in inches, A4 otherwise. */
export async function buildSpecSheet(project: Project, catalog: Catalog, opts: { date?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${project.name} — spec sheet`);
  doc.setCreator('Home Design');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(doc, project.units === 'in' ? PAGE.letter : PAGE.a4, font, bold);
  const estimate = buildEstimate(project, catalog);

  if (projectKind(project) === 'closet') await closetPages(sheet, project, estimate);
  else await kitchenPages(sheet, project, catalog, estimate);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const date = (opts.date ?? today).slice(0, 10);
  sheet.footers(`${project.name} · ${date} · revision ${project.revision}`);
  return doc.save();
}
