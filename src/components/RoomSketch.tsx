'use client';

import React, { useMemo, useState } from 'react';
import { newId } from '@/lib/id';
import { polygonBounds, polygonSelfIntersects, signedPolygonArea, snapToGrid, type Point } from '@/lib/plan/geometry';
import { rescaleRoomToMeasurements, SCALE_DISAGREEMENT_WARN } from '@/lib/plan/scale';
import type { Measurement, Room } from '@/lib/plan/schemas';
import { wallLengthMm } from '@/lib/plan/validate';

interface RoomSketchProps {
  /** Called with the finished room (rescaled to the measurements) on "Save room". */
  onSave: (room: Room) => void;
}

/** The draw canvas covers a 10 m square — enough for any kitchen. */
const CANVAS_MM = 10_000;
const GRID_MM = 100;
const GRID_LINE_MM = 500;
const WALL_THICKNESS_MM = 100;

type Mode = { kind: 'rectangle' } | { kind: 'draw'; points: Point[] };

/**
 * Build a room without any LLM: start from a W × D rectangle or tap corners
 * on a grid, then type the measured length of one or two walls. The shape
 * you sketched (`base`) is kept separately from the measurements, and the
 * saved room is always `rescale(base + measurements)` — so adding a second
 * measurement never compounds an earlier rescale.
 */
export default function RoomSketch({ onSave }: RoomSketchProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'rectangle' });
  const [width, setWidth] = useState('3000');
  const [depth, setDepth] = useState('4000');
  const [base, setBase] = useState<Room | null>(null);
  // Typed measured lengths by wall id; only valid positive numbers count.
  const [measured, setMeasured] = useState<Record<string, string>>({});

  const widthMm = positive(width);
  const depthMm = positive(depth);

  function startFrom(polygon: Point[], initialMeasured: Record<number, number> = {}) {
    const walls = polygon.map(() => ({ id: newId(), thicknessMm: WALL_THICKNESS_MM }));
    setBase({ polygon, walls, openings: [] });
    setMeasured(
      Object.fromEntries(Object.entries(initialMeasured).map(([i, mm]) => [walls[Number(i)].id, String(mm)]))
    );
  }

  function startOver() {
    setBase(null);
    setMeasured({});
    setMode({ kind: 'rectangle' });
  }

  const result = useMemo(() => {
    if (!base) return null;
    const measurements: Measurement[] = base.walls.flatMap((w) => {
      const mm = positive(measured[w.id] ?? '');
      return mm === null ? [] : [{ wallId: w.id, lengthMm: mm, source: 'user' as const }];
    });
    return rescaleRoomToMeasurements(measurements.length > 0 ? { ...base, measurements } : base);
  }, [base, measured]);

  if (base && result) {
    const room = result.room;
    return (
      <section className="flex flex-col gap-3">
        <RoomPreview polygon={room.polygon} />
        <ol className="flex flex-col gap-2 text-sm">
          {room.walls.map((w, i) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2">
              <span className="w-32">
                Wall {i + 1} · {Math.round(wallLengthMm(room, i)).toLocaleString()} mm
              </span>
              <label className="flex items-center gap-1">
                <span className="sr-only">Wall {i + 1} measured length (mm)</span>
                <input
                  className="w-28 rounded border px-2 py-1"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  placeholder="measured mm"
                  value={measured[w.id] ?? ''}
                  onChange={(e) => setMeasured((m) => ({ ...m, [w.id]: e.target.value }))}
                />
              </label>
            </li>
          ))}
        </ol>
        {result.residual > SCALE_DISAGREEMENT_WARN && (
          <p role="alert" className="text-sm text-amber-700">
            Your measurements disagree by {Math.round(result.residual * 100)}% — the sketched shape doesn&apos;t
            match them. Check the numbers, or start over and redraw.
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="rounded bg-black px-4 py-2 text-white" onClick={() => onSave(room)}>
            Save room
          </button>
          <button type="button" className="rounded border px-4 py-2" onClick={startOver}>
            Start over
          </button>
        </div>
      </section>
    );
  }

  if (mode.kind === 'draw') {
    const { points } = mode;
    const problem = closeProblem(points);
    const setPoints = (next: Point[]) => setMode({ kind: 'draw', points: next });
    return (
      <section className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          Tap each corner of the room in order. {points.length} corner{points.length === 1 ? '' : 's'}.
        </p>
        <svg
          data-testid="sketch-canvas"
          viewBox={`0 0 ${CANVAS_MM} ${CANVAS_MM}`}
          className="aspect-square w-full max-w-md touch-manipulation border bg-white"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width === 0) return;
            const p = snapToGrid(
              [((e.clientX - rect.left) / rect.width) * CANVAS_MM, ((e.clientY - rect.top) / rect.height) * CANVAS_MM],
              GRID_MM
            );
            const last = points[points.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) setPoints([...points, p]);
          }}
        >
          <Grid />
          {points.length > 1 && (
            <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="black" strokeWidth={60} />
          )}
          {points.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={90} fill={i === 0 ? 'red' : 'black'} />
          ))}
        </svg>
        {points.length >= 3 && problem && <p className="text-sm text-amber-700">{problem}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
            disabled={problem !== null}
            onClick={() => startFrom(points)}
          >
            Close shape
          </button>
          <button
            type="button"
            className="rounded border px-4 py-2 disabled:opacity-40"
            disabled={points.length === 0}
            onClick={() => setPoints(points.slice(0, -1))}
          >
            Undo corner
          </button>
          <button type="button" className="rounded border px-4 py-2" onClick={startOver}>
            Start over
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>Width (mm)</span>
          <input
            className="w-28 rounded border px-2 py-1"
            type="number"
            inputMode="decimal"
            min={1}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Depth (mm)</span>
          <input
            className="w-28 rounded border px-2 py-1"
            type="number"
            inputMode="decimal"
            min={1}
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={widthMm === null || depthMm === null}
          onClick={() => {
            if (widthMm === null || depthMm === null) return;
            startFrom(
              [
                [0, 0],
                [widthMm, 0],
                [widthMm, depthMm],
                [0, depthMm],
              ],
              { 0: widthMm, 1: depthMm }
            );
          }}
        >
          Use rectangle
        </button>
      </div>
      <p className="text-sm text-gray-600">
        Not a rectangle?{' '}
        <button type="button" className="underline" onClick={() => setMode({ kind: 'draw', points: [] })}>
          Draw corners
        </button>
      </p>
    </section>
  );
}

/** Why the drawn corners can't be closed into a room yet, or null if they can. */
function closeProblem(points: Point[]): string | null {
  if (points.length < 3) return 'Add at least three corners.';
  if (polygonSelfIntersects(points)) return 'The walls cross each other — undo a corner and try again.';
  if (Math.abs(signedPolygonArea(points)) < 1) return 'The corners are all in a line.';
  return null;
}

function positive(s: string): number | null {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

function Grid() {
  const lines = [];
  for (let v = GRID_LINE_MM; v < CANVAS_MM; v += GRID_LINE_MM) {
    lines.push(<line key={`v${v}`} x1={v} y1={0} x2={v} y2={CANVAS_MM} stroke="#e5e7eb" strokeWidth={10} />);
    lines.push(<line key={`h${v}`} x1={0} y1={v} x2={CANVAS_MM} y2={v} stroke="#e5e7eb" strokeWidth={10} />);
  }
  return <g>{lines}</g>;
}

function RoomPreview({ polygon }: { polygon: Point[] }) {
  const b = polygonBounds(polygon);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08;
  const stroke = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 100;
  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      className="max-h-72 w-full max-w-md border bg-white"
      role="img"
      aria-label="Room outline preview"
    >
      <polygon points={polygon.map((p) => p.join(',')).join(' ')} fill="#f3f4f6" stroke="black" strokeWidth={stroke} />
      {polygon.map((p, i) => {
        const q = polygon[(i + 1) % polygon.length];
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
