'use client';

import React from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { screenToWorld, gridStepMm, formatLength, type Viewport } from '@/lib/plan/viewport';
import { wallLengthMm } from '@/lib/plan/validate';
import { signedPolygonArea, type Point } from '@/lib/plan/geometry';
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
}

/** Wall label box, in screen pixels. */
const LABEL_W = 110;
const LABEL_H = 18;

/**
 * Konva drawing of the plan in world millimetres; the stage transform is
 * the viewport. Screen-constant sizes (grid lines, labels) divide by scale.
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
  // +1 if the polygon winds so that the left-hand normal of each edge points inside.
  const inside = signedPolygonArea(poly as Point[]) >= 0 ? 1 : -1;

  return (
    <Stage width={width} height={height} x={viewport.x} y={viewport.y} scaleX={scale} scaleY={scale}>
      <Layer listening={false}>{grid}</Layer>
      <Layer>
        <Line points={poly.flat()} closed fill="#f3f4f6" strokeEnabled={false} />
        {room.walls.map((w, i) => {
          if (i >= n) return null;
          const [a, b] = [poly[i], poly[(i + 1) % n]];
          return (
            <Line
              key={w.id}
              points={[a[0], a[1], b[0], b[1]]}
              stroke="#111827"
              strokeWidth={w.thicknessMm}
              lineCap="square"
            />
          );
        })}
        {room.openings.map((o) => {
          const i = wallIndex.get(o.wallId);
          if (i === undefined || i >= n) return null;
          const [a, b] = [poly[i], poly[(i + 1) % n]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const [dx, dy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
          const thickness = room.walls[i].thicknessMm;
          const points = [
            a[0] + dx * o.positionMm,
            a[1] + dy * o.positionMm,
            a[0] + dx * (o.positionMm + o.widthMm),
            a[1] + dy * (o.positionMm + o.widthMm),
          ];
          return (
            <Group key={o.id}>
              {editing && o.id === selectedOpening && (
                <Line points={points} stroke="#dc2626" strokeWidth={thickness * 1.2 + px(8)} opacity={0.5} />
              )}
              <Line points={points} stroke={OPENING_COLOR[o.kind]} strokeWidth={thickness * 1.2} />
              {editing &&
                [0, 2].map((k) => (
                  <Rect
                    key={k}
                    x={points[k] - px(5)}
                    y={points[k + 1] - px(5)}
                    width={px(10)}
                    height={px(10)}
                    fill="white"
                    stroke={OPENING_COLOR[o.kind]}
                    strokeWidth={px(2)}
                  />
                ))}
            </Group>
          );
        })}
        {items.map((it) => (
          <Rect
            key={it.id}
            x={it.position.x}
            y={it.position.y}
            width={it.sizeMm.w}
            height={it.sizeMm.d}
            offsetX={it.sizeMm.w / 2}
            offsetY={it.sizeMm.d / 2}
            rotation={it.rotationDeg}
            fill="#fde68a"
            stroke="#92400e"
            strokeWidth={px(1)}
          />
        ))}
        {room.walls.map((w, i) => {
          if (i >= n) return null;
          const [a, b] = [poly[i], poly[(i + 1) % n]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          // Unit normal pointing into the room, so the label sits just inside the wall.
          const [nx, ny] = [(-(b[1] - a[1]) / len) * inside, ((b[0] - a[0]) / len) * inside];
          const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          // Clear the wall by half its thickness plus the label's half-extent along the normal.
          const inset = w.thicknessMm / 2 + px(6 + Math.abs(nx) * (LABEL_W / 2) + Math.abs(ny) * (LABEL_H / 2));
          return (
            <Group key={`label-${w.id}`} x={mx + nx * inset} y={my + ny * inset} listening={false}>
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
