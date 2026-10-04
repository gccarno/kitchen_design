import React from 'react';
import { closetDrawing, type Shape } from '@/lib/closet/drawing';
import type { Closet } from '@/lib/plan/schemas';

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
        <ShapeEl key={i} shape={s} onPointerDown={onComponentPointerDown} />
      ))}
      {children}
    </svg>
  );
}

function ShapeEl({ shape: s, onPointerDown }: { shape: Shape; onPointerDown?: ClosetElevationProps['onComponentPointerDown'] }) {
  const id = s.componentId;
  const interactive = !!(onPointerDown && id);
  const common = {
    pointerEvents: interactive ? undefined : ('none' as const),
    style: interactive ? { cursor: 'move' } : undefined,
    onPointerDown: interactive ? (e: React.PointerEvent<SVGElement>) => onPointerDown!(id!, e) : undefined,
    'data-component': id,
  };
  const dash = 'dash' in s && s.dash ? s.dash.join(' ') : undefined;
  switch (s.type) {
    case 'rect':
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={dash} {...common} />;
    case 'line':
      // A wide invisible twin makes thin lines easy to grab.
      return (
        <g {...common}>
          {interactive && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={80} />}
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={dash} />
        </g>
      );
    case 'circle':
      return <circle cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} {...common} />;
    case 'text':
      return (
        <text x={s.x} y={s.y} fontSize={s.size} textAnchor={s.anchor} dominantBaseline="middle" fill={s.fill} {...common} pointerEvents="none">
          {s.text}
        </text>
      );
  }
}
