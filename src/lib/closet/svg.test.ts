import { describe, it, expect } from 'vitest';
import { ProjectSchema, type Project } from '../plan/schemas';
import { closetFootprint, newCloset, newComponent } from './catalog';
import { closetDrawing } from './drawing';
import { closetToSvg } from './svg';

function project(): Project {
  const closet = {
    ...newCloset(),
    opening: { style: 'bifold' as const, leftMm: 100, widthMm: 1600 },
    components: [newComponent('shelf', 'a', 0, { widthMm: 1830 }), newComponent('drawers', 'b', 600), newComponent('rod', 'c', 0)],
  };
  return ProjectSchema.parse({
    id: 'p',
    name: 'Hall <closet>',
    kind: 'closet',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
    revision: 4,
    photos: [],
    room: { polygon: closetFootprint(closet), walls: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, thicknessMm: 100 })), openings: [] },
    items: [],
    closet,
    history: [],
  });
}

describe('closetDrawing', () => {
  it('draws every component, tagged with its id, and labels them c1…', () => {
    const shapes = closetDrawing(project().closet!);
    for (const id of ['a', 'b', 'c']) expect(shapes.some((s) => s.componentId === id)).toBe(true);
    const labels = shapes.filter((s) => s.type === 'text').map((s) => (s.type === 'text' ? s.text : ''));
    expect(labels).toEqual(['c1', 'c2', 'c3']);
  });

  it('puts a box’s bottom at its height above the floor (y down)', () => {
    const closet = { ...newCloset(), components: [newComponent('drawers', 'd', 0, { yMm: 100, heightMm: 900 })] };
    const box = closetDrawing(closet).find((s) => s.componentId === 'd' && s.type === 'rect');
    expect(box).toMatchObject({ type: 'rect', x: 0, y: 2440 - 1000, h: 900 });
  });

  it('draws one divider per drawer after the first', () => {
    const closet = { ...newCloset(), components: [newComponent('drawers', 'd', 0, { count: 3 })] };
    const lines = closetDrawing(closet).filter((s) => s.componentId === 'd' && s.type === 'line');
    // 2 dividers + 3 handles
    expect(lines).toHaveLength(5);
  });
});

describe('closetToSvg', () => {
  const svg = closetToSvg(project());

  it('is a standalone SVG with an escaped title', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Hall &lt;closet&gt;</title>');
  });

  it('dimensions the width and height', () => {
    expect(svg).toContain('>1830 mm</text>');
    expect(svg).toContain('>2440 mm</text>');
  });

  it('describes the door and depth in the title block', () => {
    expect(svg).toContain('Front elevation · 610 mm deep · Bifold doors, 1600 mm opening at 100 mm from the left');
    expect(svg).toContain('Scale 1:50 · revision 4 · 2026-02-03');
  });

  it('labels components with their refs', () => {
    expect(svg).toContain('>c2</text>');
  });

  it('uses feet and inches for imperial projects', () => {
    expect(closetToSvg({ ...project(), units: 'in' })).toContain('>6&apos; 0&quot;</text>');
  });
});
