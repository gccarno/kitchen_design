import type { OpeningKind } from '@/lib/plan/schemas';

/** Colour of each opening kind, shared by the canvas, thumbnails, and legend. */
export const OPENING_COLOR: Record<OpeningKind, string> = {
  door: '#2563eb',
  window: '#0d9488',
  pass_through: '#9333ea',
};
