'use client';

import React, { useState } from 'react';
import DrawingShape from './DrawingShape';
import type { WallElevation } from '@/lib/plan/elevation';
import { elevationDrawing, elevationFrame } from '@/lib/plan/elevation-drawing';
import type { Finishes } from '@/lib/plan/schemas';

/** The kitchen's walls as front elevations, one at a time, worked out from the plan. */
export default function KitchenElevations({
  elevations,
  units,
  finishes,
}: {
  elevations: WallElevation[];
  units: 'mm' | 'in';
  finishes?: Finishes;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  if (elevations.length === 0) {
    return <p className="text-sm text-gray-600">Place cabinets or appliances against a wall to see its elevation.</p>;
  }
  // The picked wall may have lost everything on it since (an edit, an undo).
  const shown = elevations.find((e) => e.wallIndex === picked) ?? elevations[0];
  const f = elevationFrame(shown);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Walls">
        {elevations.map((e) => (
          <button
            key={e.wallIndex}
            type="button"
            aria-pressed={e.wallIndex === shown.wallIndex}
            className={`rounded border px-3 py-1 text-sm ${e.wallIndex === shown.wallIndex ? 'bg-blue-600 text-white' : 'bg-white'}`}
            onClick={() => setPicked(e.wallIndex)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <svg
        viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}
        className="max-h-96 w-full border bg-white"
        role="img"
        aria-label={`Elevation of ${shown.label}`}
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {elevationDrawing(shown, units, finishes).map((s, i) => (
          <DrawingShape key={i} shape={s} />
        ))}
      </svg>
    </div>
  );
}
