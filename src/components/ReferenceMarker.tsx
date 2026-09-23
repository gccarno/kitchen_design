import { useState, useRef, useCallback } from 'react';
import { ReferenceObjectKind } from '@/lib/plan/schemas';
import React from 'react';

interface ReferenceMarkerProps {
  imageUrl: string;
  onChange: (value: {
    kind: ReferenceObjectKind;
    pixelBox: [number, number, number, number]; // [x1, y1, x2, y2] in image pixel coordinates
    lengthMM: number; // real-world length in mm that the box represents
  } | null) => void;
}

// Map of reference object kinds to their real-world dimensions (in mm)
// For simplicity, we define a nominal length: for rectangular objects we use the width,
// for circular we use diameter.
const REFERENCE_OBJECT_SIZES: Record<ReferenceObjectKind, { widthMM: number; heightMM: number }> = {
  'credit_card': { widthMM: 85.60, heightMM: 53.98 },
  'coin_us_quarter': { widthMM: 24.26, heightMM: 24.26 }, // diameter
  'a4_paper': { widthMM: 210, heightMM: 297 },
  'us_letter': { widthMM: 216, heightMM: 279 }, // standard US letter paper
  'tape_measure': { widthMM: 16, heightMM: 120 }, // typical tape measure
  'custom': { widthMM: 0, heightMM: 0 }, // will be overridden by custom input
};

export default function ReferenceMarker({ imageUrl, onChange }: ReferenceMarkerProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [selectedKind, setSelectedKind] = useState<ReferenceObjectKind>('credit_card');

  const handleKindChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = e.target.value as ReferenceObjectKind;
    setSelectedKind(kind);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setIsDrawing(true);
    startRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isDrawing || !imgRef.current || !startRef.current) return;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    // Draw a preview rectangle; we'll implement via CSS overlay later.
    // For now, we just store the current coords in state? We'll skip preview for MVP.
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isDrawing || !imgRef.current || !startRef.current) return;
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const start = startRef.current;
    const pixelBox: [number, number, number, number] = [
      Math.min(start.x, endX),
      Math.min(start.y, endY),
      Math.max(start.x, endX),
      Math.max(start.y, endY),
    ];

    // Compute lengthMM based on the selected kind and the pixel box dimensions.
    // We'll use the width of the pixel box to scale to the real-world width.
    const refSize = REFERENCE_OBJECT_SIZES[selectedKind];
    let lengthMM = 0;
    if (refSize.widthMM > 0 && refSize.heightMM > 0) {
      const pixelWidth = Math.abs(endX - start.x);
      const pixelHeight = Math.abs(endY - start.y);
      // Avoid division by zero
      if (pixelWidth > 0) {
        // Scale factor: real width per pixel
        const scale = refSize.widthMM / pixelWidth;
        // We'll define lengthMM as the real-world width that the box represents.
        // For simplicity, we use the width dimension.
        lengthMM = refSize.widthMM; // Actually, we want to compute based on the box size.
        // Wait: the user drew a box around the reference object. The box size in pixels corresponds to the real size.
        // So if the user drew a box exactly around the reference object, then pixelWidth corresponds to refSize.widthMM.
        // Therefore, the scale is refSize.widthMM / pixelWidth.
        // Then any other length in the image can be computed by multiplying pixel distance by scale.
        // For the reference object itself, we can set lengthMM to refSize.widthMM (or heightMM) as the known dimension.
        // We'll store the scale and use it elsewhere? Actually, the plan says we store the reference object and its real-world length.
        // We'll store the kind and the real-world length (which is the known dimension of the object).
        // So we can set lengthMM to refSize.widthMM (or we could store both width and height).
        // For simplicity, we'll store the width as the lengthMM.
        lengthMM = refSize.widthMM;
      } else if (pixelHeight > 0) {
        lengthMM = refSize.heightMM;
      }
    }

    // For now, we ignore the custom kind and assume a default lengthMM.
    // TODO: handle custom kind with user input.

    onChange({
      kind: selectedKind,
      pixelBox,
      lengthMM,
    });

    setIsDrawing(false);
    startRef.current = null;
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <label htmlFor="reference-object-select">Reference object</label>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Reference"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ display: 'block', maxWidth: '100%' }}
      />
      {/* Dropdown for reference object kind */}
      <select
        id="reference-object-select"
        value={selectedKind}
        onChange={handleKindChange}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 10,
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid #ccc',
          borderRadius: 4,
          padding: '2px 6px',
        }}
      >
        {/* Options will be populated from ReferenceObjectKind enum */}
        <option value="">Select reference object</option>
        <option value="credit_card">Credit Card (85.60 × 53.98 mm)</option>
        <option value="coin_us_quarter">US Quarter (24.26 mm diameter)</option>
        <option value="us_letter">US Letter (216 × 279 mm)</option>
        <option value="tape_measure">Tape Measure (16 × 120 mm)</option>
        <option value="a4_paper">A4 Paper (210 × 297 mm)</option>
        <option value="custom">Custom length</option>
      </select>
      {/* TODO: custom length input when kind === 'custom' */}
    </div>
  );
}