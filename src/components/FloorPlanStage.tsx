'use client';

import React from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { screenToWorld, gridStepMm, formatLength, type Viewport } from '@/lib/plan/viewport';
import { wallLengthMm } from '@/lib/plan/validate';
import { inwardNormal, wallQuads } from '@/lib/plan/walls';
import type { PlacedItem, Room } from '@/lib/plan/schemas';
import { OPENING_COLOR } from './plan-colors';

export interface FloorPlanStageProps {
  width: number;
  height: number;
  viewport: Viewport;
  room: Room;
  items: PlacedItem[];
  units: 'mm' | 'in';
  /** Show corner handles, "+" handles on each wall, and opening end handles. */
  editing?: boolean;
  /** Highlighted corner (editing only). */
  selectedCorner?: number | null;
  /** Highlighted opening id (editing only). */
  selectedOpening?: string | null;
  /** Highlighted placed item id. */
  selectedItem?: string | null;
  /** Display names for placed items, by item id. */
  itemLabels?: Record<string, string>;
}

/** Wall label box, in screen pixels. */
const LABEL_W = 110;
const LABEL_H = 18;
const LEVEL_ORDER = { floor: 0, counter: 1, wall: 2 } as const;

/**
 * Konva drawing of the plan in world millimetres; the stage transform is
 * the viewport. Screen-constant sizes (grid lines, labels) divide by scale.
 * The room polygon is the walls' interior face, so walls are drawn outward.
 * Loaded client-side only (Konva needs `window`).
 */
export default function FloorPlanStage({
  width,
  height,
  viewport,
  room,
  items,
  units,
  editing = false,
  selectedCorner = null,
  selectedOpening = null,
  selectedItem = null,
  itemLabels = {},
}: FloorPlanStageProps) {
  const { scale } = viewport;
  const px = (n: number) => n / scale; // n screen pixels in world mm
  const [x0, y0] = screenToWorld(viewport, [0, 0]);
  const [x1, y1] = screenToWorld(viewport, [width, height]);
  const step = gridStepMm(scale);

  const grid: React.ReactNode[] = [];
  for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step) {
    grid.push(<Line key={`gx${gx}`} points={[gx, y0, gx, y1]} stroke="#e5e7eb" strokeWidth={px(1)} listening={false} />);
  }
  for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
    grid.push(<Line key={`gy${gy}`} points={[x0, gy, x1, gy]} stroke="#e5e7eb" strokeWidth={px(1)} listening={false} />);
  }

  const poly = room.polygon;
  const n = poly.length;
  const wallIndex = new Map(room.walls.map((w, i) => [w.id, i]));
  const quads = wallQuads(room);
  const byLevel = [...items].sort((a, b) => LEVEL_ORDER[a.mount ?? 'floor'] - LEVEL_ORDER[b.mount ?? 'floor']);

  return (
    <Stage width={width} height={height} x={viewport.x} y={viewport.y} scaleX={scale} scaleY={scale}>
      <Layer listening={false}>{grid}</Layer>
      <Layer>
        <Line points={poly.flat()} closed fill="#f3f4f6" strokeEnabled={false} />
        {quads.map((q, i) => (
          <Line key={room.walls[i]?.id ?? i} points={q.flat()} closed fill="#111827" strokeEnabled={false} />
        ))}
        {room.openings.map((o) => {
          const i = wallIndex.get(o.wallId);
          if (i === undefined || i >= n) return null;
          const [a, b] = [poly[i], poly[(i + 1) % n]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const [dx, dy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
          const [nx, ny] = inwardNormal(room, i);
          const t = room.walls[i].thicknessMm;
          const at = (mm: number, out: number) => [a[0] + dx * mm - nx * out, a[1] + dy * mm - ny * out];
          const start = o.positionMm;
          const end = o.positionMm + o.widthMm;
          const body = [...at(start, 0), ...at(end, 0), ...at(end, t), ...at(start, t)];
          return (
            <Group key={o.id}>
              {editing && o.id === selectedOpening && (
                <Line points={body} closed stroke="#dc2626" strokeWidth={px(6)} opacity={0.6} />
              )}
              <Line points={body} closed fill={OPENING_COLOR[o.kind]} strokeEnabled={false} />
              {editing &&
                [start, end].map((mm) => {
                  const [hx, hy] = at(mm, 0);
                  return (
                    <Rect
                      key={mm}
                      x={hx - px(5)}
                      y={hy - px(5)}
                      width={px(10)}
                      height={px(10)}
                      fill="white"
                      stroke={OPENING_COLOR[o.kind]}
                      strokeWidth={px(2)}
                    />
                  );
                })}
            </Group>
          );
        })}
        {byLevel.map((it) => {
          const onWall = it.mount === 'wall';
          const selected = it.id === selectedItem;
          const { w, d } = it.sizeMm;
          const label = itemLabels[it.id];
          return (
            <Group key={it.id} x={it.position.x} y={it.position.y} rotation={it.rotationDeg}>
              <Rect
                x={-w / 2}
                y={-d / 2}
                width={w}
                height={d}
                fill={onWall ? '#bfdbfe' : it.mount === 'counter' ? '#fed7aa' : '#fde68a'}
                opacity={onWall ? 0.55 : 1}
                stroke={selected ? '#dc2626' : onWall ? '#1d4ed8' : '#92400e'}
                strokeWidth={px(selected ? 3 : 1)}
                dash={onWall ? [px(6), px(4)] : undefined}
              />
              {/* Front edge: shows which way the item faces. */}
              <Line points={[-w / 2, d / 2, w / 2, d / 2]} stroke={onWall ? '#1d4ed8' : '#92400e'} strokeWidth={px(3)} />
              {label && w * scale >= 40 && (
                <Text
                  text={label}
                  x={-w / 2}
                  y={-px(7)}
                  width={w}
                  align="center"
                  fontSize={px(11)}
                  fill="#111827"
                  wrap="none"
                  ellipsis
                />
              )}
            </Group>
          );
        })}
        {room.walls.map((w, i) => {
          if (i >= n) return null;
          const [a, b] = [poly[i], poly[(i + 1) % n]];
          const [nx, ny] = inwardNormal(room, i);
          const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          // Outside the wall (the room is kept clear for items), running along it like a
          // dimension label, and turned so the text is never upside down.
          const out = w.thicknessMm + px(6 + LABEL_H / 2);
          let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle <= -90) angle += 180;
          return (
            <Group
              key={`label-${w.id}`}
              x={mx - nx * out}
              y={my - ny * out}
              rotation={angle}
              listening={false}
            >
              <Rect
                x={-px(LABEL_W / 2)}
                y={-px(LABEL_H / 2)}
                width={px(LABEL_W)}
                height={px(LABEL_H)}
                fill="white"
                opacity={0.85}
                cornerRadius={px(3)}
              />
              <Text
                text={`${i + 1} · ${formatLength(wallLengthMm(room, i), units)}`}
                x={-px(LABEL_W / 2)}
                y={-px(LABEL_H / 2)}
                width={px(LABEL_W)}
                height={px(LABEL_H)}
                align="center"
                verticalAlign="middle"
                fontSize={px(12)}
                fill="#111827"
              />
            </Group>
          );
        })}
      </Layer>
      {editing && (
        // Hit testing is done in FloorPlanCanvas (canvas-hit.ts), so handles don't listen.
        <Layer listening={false}>
          {poly.map((a, i) => {
            const b = poly[(i + 1) % n];
            const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            // No "+" where an opening covers the midpoint: a tap there selects the opening.
            const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
            const covered = room.openings.some(
              (o) => o.wallId === room.walls[i]?.id && o.positionMm <= half && half <= o.positionMm + o.widthMm
            );
            if (covered) return null;
            return (
              <Group key={`add-${i}`} x={mx} y={my}>
                <Circle radius={px(8)} fill="white" stroke="#2563eb" strokeWidth={px(1.5)} />
                <Line points={[-px(4), 0, px(4), 0]} stroke="#2563eb" strokeWidth={px(1.5)} />
                <Line points={[0, -px(4), 0, px(4)]} stroke="#2563eb" strokeWidth={px(1.5)} />
              </Group>
            );
          })}
          {poly.map((p, i) => (
            <Circle
              key={`corner-${i}`}
              x={p[0]}
              y={p[1]}
              radius={px(i === selectedCorner ? 9 : 7)}
              fill={i === selectedCorner ? '#dc2626' : 'white'}
              stroke="#111827"
              strokeWidth={px(2)}
            />
          ))}
        </Layer>
      )}
    </Stage>
  );
}
