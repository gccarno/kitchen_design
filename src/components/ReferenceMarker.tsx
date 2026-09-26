'use client';

import React, { useRef, useState } from 'react';
import { REFERENCE_OBJECTS, type ReferenceInput } from '@/lib/plan/reference-objects';
import type { ReferenceObjectKind, ReferenceSide } from '@/lib/plan/schemas';

type Box = [number, number, number, number];

interface ReferenceMarkerProps {
  imageUrl: string;
  /** Initial reference, e.g. from the saved photo. Read once on mount. */
  value?: ReferenceInput | null;
  /**
   * Called with a complete reference (box in NATURAL image pixels) whenever
   * the box, object, edge, or custom size changes — or `null` when cleared.
   * Not called while the input is incomplete (no box yet, custom size missing).
   */
  onChange: (value: ReferenceInput | null) => void;
}

/** Drags shorter than this (natural px) are treated as taps and ignored. */
const MIN_BOX_PX = 3;

const KIND_OPTIONS = Object.entries(REFERENCE_OBJECTS).map(([kind, spec]) => ({
  kind: kind as ReferenceObjectKind,
  label:
    spec.longMm === spec.shortMm
      ? `${spec.label} (${spec.longMm} mm)`
      : `${spec.label} (${spec.longMm} × ${spec.shortMm} mm)`,
}));

/**
 * Let the user drag a box around a known-size object in a photo. Works with
 * mouse, touch, and pen via pointer events. The box is tracked in natural
 * image pixels and drawn as percentages, so it stays put when the image
 * is displayed at a different size.
 */
export default function ReferenceMarker({ imageUrl, value, onChange }: ReferenceMarkerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<[number, number] | null>(null);
  // The committed box when the current drag began; restored on tap or cancel.
  const boxBeforeDrag = useRef<Box | null>(null);

  const [kind, setKind] = useState<ReferenceObjectKind>(value?.kind ?? 'credit_card');
  const [side, setSide] = useState<ReferenceSide>(value?.side ?? 'long');
  const [customSize, setCustomSize] = useState(value?.customSizeMm ? String(value.customSizeMm) : '');
  const [box, setBox] = useState<Box | null>(value?.pixelBox ?? null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  function emit(next: { kind: ReferenceObjectKind; side: ReferenceSide; customSize: string; box: Box | null }) {
    if (!next.box) return;
    if (next.kind !== 'custom') {
      onChange({ kind: next.kind, side: next.side, pixelBox: next.box });
      return;
    }
    const size = Number(next.customSize);
    if (next.customSize !== '' && Number.isFinite(size) && size > 0) {
      onChange({ kind: 'custom', side: next.side, customSizeMm: size, pixelBox: next.box });
    }
  }

  /** Pointer position in natural image pixels, clamped to the image. */
  function toNatural(e: React.PointerEvent): [number, number] | null {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((e.clientX - rect.left) * img.naturalWidth) / rect.width;
    const y = ((e.clientY - rect.top) * img.naturalHeight) / rect.height;
    return [
      Math.round(Math.min(Math.max(x, 0), img.naturalWidth)),
      Math.round(Math.min(Math.max(y, 0), img.naturalHeight)),
    ];
  }

  function boxFrom(a: [number, number], b: [number, number]): Box {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = toNatural(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort (unsupported in some test DOMs).
    }
    dragStart.current = p;
    boxBeforeDrag.current = box;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    const p = start && toNatural(e);
    if (start && p) setBox(boxFrom(start, p));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    dragStart.current = null;
    const p = start && toNatural(e);
    if (!start || !p) return;
    const next = boxFrom(start, p);
    if (next[2] - next[0] < MIN_BOX_PX || next[3] - next[1] < MIN_BOX_PX) {
      // A tap, not a drag: keep whatever box was there before.
      setBox(boxBeforeDrag.current);
      return;
    }
    setBox(next);
    emit({ kind, side, customSize, box: next });
  }

  function handleClear() {
    setBox(null);
    onChange(null);
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>Reference object</span>
          <select
            className="rounded border px-2 py-1"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as ReferenceObjectKind;
              setKind(k);
              emit({ kind: k, side, customSize, box });
            }}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>
                {o.label}
              </option>
            ))}
            <option value="custom">Custom object…</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span>Edge in the box</span>
          <select
            className="rounded border px-2 py-1"
            value={side}
            onChange={(e) => {
              const s = e.target.value as ReferenceSide;
              setSide(s);
              emit({ kind, side: s, customSize, box });
            }}
          >
            <option value="long">Long edge</option>
            <option value="short">Short edge</option>
          </select>
        </label>

        {kind === 'custom' && (
          <label className="flex flex-col gap-1">
            <span>Size (mm)</span>
            <input
              className="w-24 rounded border px-2 py-1"
              type="number"
              inputMode="decimal"
              min={1}
              value={customSize}
              onChange={(e) => {
                setCustomSize(e.target.value);
                emit({ kind, side, customSize: e.target.value, box });
              }}
            />
          </label>
        )}

        <button type="button" className="rounded border px-3 py-1" onClick={handleClear} disabled={!box}>
          Clear
        </button>
      </div>

      <div
        data-testid="reference-surface"
        className="relative inline-block max-w-full cursor-crosshair select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          if (!dragStart.current) return;
          dragStart.current = null;
          setBox(boxBeforeDrag.current);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our API route, not a static asset */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Photo to mark the reference object on"
          draggable={false}
          className="block max-w-full"
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
        {box && natural && (
          <div
            data-testid="reference-box"
            className="pointer-events-none absolute border-2 border-red-500 bg-red-500/10"
            style={{
              left: pct(box[0], natural.w),
              top: pct(box[1], natural.h),
              width: pct(box[2] - box[0], natural.w),
              height: pct(box[3] - box[1], natural.h),
            }}
          />
        )}
      </div>
      <p className="text-xs text-gray-500">
        Drag a box tightly around the object, then pick which of its edges you want measured.
      </p>
    </div>
  );
}
