/**
 * Paper for the spec sheet: page sizes, margins, and the standard drawing
 * scales, so drawings can be measured with a scale rule. Pure.
 */

/** Paper sizes in points (1/72 in), portrait. */
export const PAGE = { letter: [612, 792], a4: [595.28, 841.89] } as const;
/** 15 mm. */
export const MARGIN_PT = 42.52;
/** Millimetres per point. */
export const PT_MM = 25.4 / 72;
/** Drawing scales tried, largest drawing first (1:N). */
export const STANDARD_SCALES = [20, 25, 50, 100] as const;

/**
 * The smallest N in STANDARD_SCALES (the largest drawing) at which a drawing
 * covering `drawingMm` fits `boxPt` at 1:N; null if not even 1:100 fits.
 */
export function pickScale(drawingMm: { w: number; h: number }, boxPt: { w: number; h: number }): number | null {
  const box = { w: boxPt.w * PT_MM, h: boxPt.h * PT_MM };
  return STANDARD_SCALES.find((n) => drawingMm.w / n <= box.w && drawingMm.h / n <= box.h) ?? null;
}

/** The real size (plan mm) one of our SVG drawings covers: its viewBox width and height. */
export function svgViewBoxSize(svg: string): { w: number; h: number } {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('drawing has no viewBox');
  return { w: Number(m[1]), h: Number(m[2]) };
}
