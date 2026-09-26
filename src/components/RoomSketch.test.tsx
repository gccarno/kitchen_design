import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import RoomSketch from './RoomSketch';
import { validatePlan, wallLengthMm } from '@/lib/plan/validate';
import { ProjectSchema, type Room } from '@/lib/plan/schemas';

/** Wrap a room in a minimal project so validatePlan can check it. */
function asProject(room: Room) {
  return ProjectSchema.parse({
    id: 'p',
    name: 'p',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 0,
    photos: [],
    room,
    items: [],
    history: [],
  });
}

function savedRoom(onSave: ReturnType<typeof vi.fn>): Room {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as Room;
}

/** The draw canvas is 10 m square; make it 500 CSS px so 1 px = 20 mm. */
function drawCanvas(): SVGSVGElement {
  const svg = screen.getByTestId('sketch-canvas') as unknown as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return svg;
}

const tap = (svg: SVGSVGElement, x: number, y: number) => fireEvent.click(svg, { clientX: x, clientY: y });

describe('RoomSketch', () => {
  describe('rectangle quick start', () => {
    it('saves a W × D room with both dimensions recorded as measurements', () => {
      const onSave = vi.fn();
      render(<RoomSketch onSave={onSave} />);
      fireEvent.change(screen.getByLabelText(/width/i), { target: { value: '3000' } });
      fireEvent.change(screen.getByLabelText(/depth/i), { target: { value: '4000' } });
      fireEvent.click(screen.getByRole('button', { name: /use rectangle/i }));
      fireEvent.click(screen.getByRole('button', { name: /save room/i }));

      const room = savedRoom(onSave);
      expect(room.polygon).toEqual([
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ]);
      expect(new Set(room.walls.map((w) => w.id)).size).toBe(4);
      expect(room.measurements).toEqual([
        { wallId: room.walls[0].id, lengthMm: 3000, source: 'user' },
        { wallId: room.walls[1].id, lengthMm: 4000, source: 'user' },
      ]);
      expect(validatePlan(asProject(room)).valid).toBe(true);
    });

    it.each(['', '0', '-5', 'abc'])('disables the rectangle button for width %j', (w) => {
      render(<RoomSketch onSave={vi.fn()} />);
      fireEvent.change(screen.getByLabelText(/width/i), { target: { value: w } });
      expect((screen.getByRole('button', { name: /use rectangle/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('has nothing to save before a shape exists', () => {
      render(<RoomSketch onSave={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /save room/i })).toBeNull();
    });
  });

  describe('drawing corners', () => {
    function openDraw() {
      const onSave = vi.fn();
      render(<RoomSketch onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: /draw corners/i }));
      return { onSave, svg: drawCanvas() };
    }

    it('snaps taps to a 100 mm grid and closes into a room', () => {
      const { onSave, svg } = openDraw();
      // 1 px = 20 mm; (51, 49) → (1020, 980) → snapped (1000, 1000).
      tap(svg, 51, 49);
      tap(svg, 201, 50);
      tap(svg, 200, 250);
      tap(svg, 50, 251);
      fireEvent.click(screen.getByRole('button', { name: /close shape/i }));
      fireEvent.click(screen.getByRole('button', { name: /save room/i }));

      const room = savedRoom(onSave);
      expect(room.polygon).toEqual([
        [1000, 1000],
        [4000, 1000],
        [4000, 5000],
        [1000, 5000],
      ]);
      expect(room.walls).toHaveLength(4);
      expect(room.measurements ?? []).toEqual([]);
      expect(validatePlan(asProject(room)).valid).toBe(true);
    });

    it('needs at least three corners to close', () => {
      const { svg } = openDraw();
      tap(svg, 50, 50);
      tap(svg, 200, 50);
      expect((screen.getByRole('button', { name: /close shape/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('refuses to close a self-intersecting shape', () => {
      const { svg } = openDraw();
      tap(svg, 0, 0);
      tap(svg, 200, 200);
      tap(svg, 200, 0);
      tap(svg, 0, 200);
      expect((screen.getByRole('button', { name: /close shape/i }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/cross/i)).not.toBeNull();
    });

    it('ignores a tap on the same grid point as the last corner', () => {
      const { svg } = openDraw();
      tap(svg, 50, 50);
      tap(svg, 51, 51);
      expect(screen.getByText(/1 corner/i)).not.toBeNull();
    });

    it('undoes the last corner', () => {
      const { svg } = openDraw();
      tap(svg, 50, 50);
      tap(svg, 200, 50);
      fireEvent.click(screen.getByRole('button', { name: /undo corner/i }));
      expect(screen.getByText(/1 corner/i)).not.toBeNull();
    });
  });

  describe('measured walls', () => {
    function sketchedSquare() {
      const onSave = vi.fn();
      render(<RoomSketch onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: /draw corners/i }));
      const svg = drawCanvas();
      // A rough 3000 × 4000 room.
      tap(svg, 0, 0);
      tap(svg, 150, 0);
      tap(svg, 150, 200);
      tap(svg, 0, 200);
      fireEvent.click(screen.getByRole('button', { name: /close shape/i }));
      return onSave;
    }

    it('rescales the sketch so a measured wall has its measured length', () => {
      const onSave = sketchedSquare();
      fireEvent.change(screen.getByLabelText(/wall 1 measured/i), { target: { value: '3600' } });
      fireEvent.click(screen.getByRole('button', { name: /save room/i }));

      const room = savedRoom(onSave);
      expect(wallLengthMm(room, 0)).toBeCloseTo(3600);
      expect(wallLengthMm(room, 1)).toBeCloseTo(4800);
      expect(room.measurements).toEqual([{ wallId: room.walls[0].id, lengthMm: 3600, source: 'user' }]);
    });

    it('does not compound: a second consistent measurement leaves the first exact', () => {
      const onSave = sketchedSquare();
      fireEvent.change(screen.getByLabelText(/wall 1 measured/i), { target: { value: '3600' } });
      fireEvent.change(screen.getByLabelText(/wall 2 measured/i), { target: { value: '4800' } });
      fireEvent.click(screen.getByRole('button', { name: /save room/i }));
      const room = savedRoom(onSave);
      expect(wallLengthMm(room, 0)).toBeCloseTo(3600);
      expect(wallLengthMm(room, 1)).toBeCloseTo(4800);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('warns when two measurements disagree about the scale', () => {
      sketchedSquare();
      fireEvent.change(screen.getByLabelText(/wall 1 measured/i), { target: { value: '3300' } });
      fireEvent.change(screen.getByLabelText(/wall 2 measured/i), { target: { value: '3600' } });
      expect(screen.getByRole('alert').textContent).toMatch(/disagree.*11%/i);
    });

    it('clearing a measurement returns the wall to its sketched length', () => {
      const onSave = sketchedSquare();
      const input = screen.getByLabelText(/wall 1 measured/i);
      fireEvent.change(input, { target: { value: '3600' } });
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save room/i }));
      const room = savedRoom(onSave);
      expect(wallLengthMm(room, 0)).toBeCloseTo(3000);
      expect(room.measurements ?? []).toEqual([]);
    });
  });

  it('start over discards the shape', () => {
    render(<RoomSketch onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /use rectangle/i }));
    fireEvent.click(screen.getByRole('button', { name: /start over/i }));
    expect(screen.queryByRole('button', { name: /save room/i })).toBeNull();
  });
});
