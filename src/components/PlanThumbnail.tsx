import React from 'react';
import { polygonBounds, rotatedRectFootprint, type Bounds, type Point } from '@/lib/plan/geometry';
import type { PlacedItem, Room } from '@/lib/plan/schemas';
import { OPENING_COLOR } from './plan-colors';

interface PlanThumbnailProps {
  room: Room;
  items?: PlacedItem[];
  /** Fit to these bounds instead of the room's own — lets two thumbnails share a scale. */
  bounds?: Bounds;
  label: string;
  className?: string;
}


/** Static top-down drawing of a room: outline, numbered walls, openings, and item footprints. */
export default function PlanThumbnail({ room, items = [], bounds, label, className }: PlanThumbnailProps) {
  const poly = room.polygon as Point[];
  const b = bounds ?? polygonBounds(poly);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const pad = span * 0.08;
  const stroke = span / 100;
  const wallIndex = new Map(room.walls.map((w, i) => [w.id, i]));

  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      className={className ?? 'max-h-72 w-full border bg-white'}
      role="img"
      aria-label={label}
    >
      <polygon points={poly.map((p) => p.join(',')).join(' ')} fill="#f3f4f6" stroke="black" strokeWidth={stroke} />
      {room.openings.map((o) => {
        const i = wallIndex.get(o.wallId);
        if (i === undefined || i >= poly.length) return null;
        const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const [dx, dy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        return (
          <line
            key={o.id}
            x1={p[0] + dx * o.positionMm}
            y1={p[1] + dy * o.positionMm}
            x2={p[0] + dx * (o.positionMm + o.widthMm)}
            y2={p[1] + dy * (o.positionMm + o.widthMm)}
            stroke={OPENING_COLOR[o.kind]}
            strokeWidth={stroke * 3}
          />
        );
      })}
      {items.map((it) => (
        <polygon
          key={it.id}
          points={rotatedRectFootprint([it.position.x, it.position.y], it.sizeMm.w, it.sizeMm.d, it.rotationDeg)
            .map((p) => p.join(','))
            .join(' ')}
          fill="#fde68a"
          stroke="#92400e"
          strokeWidth={stroke / 2}
        />
      ))}
      {poly.map((p, i) => {
        const q = poly[(i + 1) % poly.length];
        return (
          <text
            key={i}
            x={(p[0] + q[0]) / 2}
            y={(p[1] + q[1]) / 2}
            fontSize={stroke * 4}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {i + 1}
          </text>
        );
      })}
    </svg>
  );
}
