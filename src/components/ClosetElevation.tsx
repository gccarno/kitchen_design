import React from 'react';
import { closetDrawing } from '@/lib/closet/drawing';
import type { Closet } from '@/lib/plan/schemas';
import DrawingShape from './DrawingShape';

interface ClosetElevationProps {
  closet: Closet;
  label: string;
  className?: string;
  selectedId?: string | null;
  /** Fit to this size (mm) instead of the closet's own — lets two drawings share a scale. */
  frame?: { widthMm: number; heightMm: number };
  /** Makes components clickable; other shapes ignore the pointer. */
  onComponentPointerDown?: (id: string, e: React.PointerEvent<SVGElement>) => void;
  svgRef?: React.Ref<SVGSVGElement>;
  /** Pointer handlers for the <svg> itself (background taps, drags captured on it). */
  svgHandlers?: Pick<
    React.SVGProps<SVGSVGElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >;
  /** Extra SVG drawn on top, in elevation mm (y down). */
  children?: React.ReactNode;
}

/** Padding around the closet, in mm. */
export const ELEVATION_PAD_MM = 60;

/** Static (or, with `onComponentPointerDown`, clickable) front elevation of a closet. */
export default function ClosetElevation({
  closet,
  label,
  className,
  selectedId = null,
  frame,
  onComponentPointerDown,
  svgRef,
  svgHandlers,
  children,
}: ClosetElevationProps) {
  const w = frame?.widthMm ?? closet.widthMm;
  const h = frame?.heightMm ?? closet.heightMm;
  const pad = ELEVATION_PAD_MM;
  // Bottom-align, so two closets of different heights share a floor line.
  const top = closet.heightMm - h;
  return (
    <svg
      ref={svgRef}
      viewBox={`${-pad} ${top - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      className={className ?? 'max-h-72 w-full border bg-white'}
      role="img"
      aria-label={label}
      fontFamily="Helvetica, Arial, sans-serif"
      {...svgHandlers}
    >
      {closetDrawing(closet, { selectedId }).map((s, i) => (
        <DrawingShape key={i} shape={s} onPointerDown={onComponentPointerDown} />
      ))}
      {children}
    </svg>
  );
}
