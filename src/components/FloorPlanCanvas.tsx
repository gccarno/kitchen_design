'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { polygonBounds, type Point } from '@/lib/plan/geometry';
import { fitToBounds, pan, pinch, rulerTicks, zoomAt, type Viewport } from '@/lib/plan/viewport';
import type { PlacedItem, Room } from '@/lib/plan/schemas';

// Konva touches `window` at import time, so the stage only loads in the browser.
const FloorPlanStage = dynamic(() => import('./FloorPlanStage'), { ssr: false });

interface FloorPlanCanvasProps {
  room: Room;
  items: PlacedItem[];
  units: 'mm' | 'in';
  label: string;
}

const RULER_PX = 22;
const BUTTON_ZOOM = 1.25;

/**
 * Pannable, zoomable view of the plan. Mouse: drag to pan, wheel to zoom
 * at the cursor. Touch: one finger pans, two fingers pinch-zoom. Rulers
 * along the top and left edges follow the view in the project's units.
 */
export default function FloorPlanCanvas({ room, items, units, label }: FloorPlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const pointers = useRef(new Map<number, Point>());

  // Track the container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the room when the canvas first has a size, and whenever the outline's extent changes.
  const b = polygonBounds(room.polygon as Point[]);
  const boundsKey = `${b.minX},${b.minY},${b.maxX},${b.maxY}`;
  const fit = useCallback(() => {
    // Fit into the area not covered by the rulers.
    if (size) setViewport(pan(fitToBounds(b, size.w - RULER_PX, size.h - RULER_PX), RULER_PX, RULER_PX));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey captures b
  }, [size, boundsKey]);
  useEffect(() => {
    if (size) fit();
    // Refit on a new outline or a new size, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, size?.w, size?.h]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.pow(1.0015, -e.deltaY);
      const at = toLocal(el, e.clientX, e.clientY);
      setViewport((v) => v && zoomAt(v, at, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: React.PointerEvent): Point => toLocal(wrapRef.current!, e.clientX, e.clientY);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    pointers.current.set(e.pointerId, local(e));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const next = local(e);
    if (map.size === 1) {
      setViewport((v) => v && pan(v, next[0] - prev[0], next[1] - prev[1]));
    } else if (map.size === 2) {
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      setViewport((v) => v && pinch(v, [prev, other], [next, other]));
    }
    map.set(e.pointerId, next);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
  }

  function zoomButton(factor: number) {
    if (!size) return;
    setViewport((v) => v && zoomAt(v, [size.w / 2, size.h / 2], factor));
  }

  const xTicks = viewport && size ? rulerTicks(viewport.scale, viewport.x, size.w, units).ticks : [];
  const yTicks = viewport && size ? rulerTicks(viewport.scale, viewport.y, size.h, units).ticks : [];

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapRef}
        data-testid="floor-plan"
        data-scale={viewport?.scale}
        data-x={viewport?.x}
        data-y={viewport?.y}
        role="img"
        aria-label={label}
        className="relative h-[60vh] max-h-[560px] min-h-[280px] w-full cursor-grab touch-none select-none overflow-hidden rounded border bg-white active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {size && viewport && (
          <FloorPlanStage width={size.w} height={size.h} viewport={viewport} room={room} items={items} units={units} />
        )}
        <div data-testid="ruler-x" aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-b bg-white/85 text-[10px] text-gray-600" style={{ height: RULER_PX }}>
          {xTicks.map((t) => (
            <span key={t.px} className="absolute top-0 h-full border-l border-gray-400 pl-0.5" style={{ left: t.px }}>
              {t.label}
            </span>
          ))}
        </div>
        <div data-testid="ruler-y" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 border-r bg-white/85 text-[10px] text-gray-600" style={{ width: RULER_PX }}>
          {yTicks.map((t) => (
            <span key={t.px} className="absolute left-0 w-full border-t border-gray-400 [writing-mode:vertical-rl]" style={{ top: t.px }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        <button type="button" className="rounded border px-3 py-1" onClick={() => zoomButton(BUTTON_ZOOM)}>
          Zoom in
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={() => zoomButton(1 / BUTTON_ZOOM)}>
          Zoom out
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}

/**
 * Client coordinates → coordinates inside the element's padding box, which
 * is where the Konva stage is drawn (getBoundingClientRect includes the border).
 */
function toLocal(el: HTMLElement, clientX: number, clientY: number): Point {
  const rect = el.getBoundingClientRect();
  return [clientX - rect.left - el.clientLeft, clientY - rect.top - el.clientTop];
}
