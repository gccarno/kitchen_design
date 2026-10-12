import React from 'react';
import type { Shape } from '@/lib/drawing/shapes';

/** One drawing shape as an SVG element; with `onPointerDown`, shapes that carry a componentId are clickable. */
export default function DrawingShape({
  shape: s,
  onPointerDown,
}: {
  shape: Shape;
  onPointerDown?: (id: string, e: React.PointerEvent<SVGElement>) => void;
}) {
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
