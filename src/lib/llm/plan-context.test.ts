import { describe, it, expect } from 'vitest';
import { compass, describeCatalogForLLM, describePlanForLLM } from './plan-context';
import { loadCatalog } from '../catalog/loader';
import { ProjectSchema, type Project } from '../plan/schemas';

const catalog = loadCatalog();

const project: Project = ProjectSchema.parse({
  id: 'p',
  name: 'Our kitchen',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 0,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [{ id: 'door', wallId: 'd', kind: 'door', positionMm: 2800, widthMm: 800, heightMm: 2100 }],
  },
  items: [
    { id: 'dw', catalogId: 'dishwasher-600', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 },
    { id: 'isl', catalogId: 'island-1200x900', sizeMm: { w: 1200, d: 900, h: 900 }, position: { x: 1500, y: 2000 }, rotationDeg: 90 },
  ],
  history: [],
});

describe('compass', () => {
  it('names directions with north up (y grows south)', () => {
    expect(compass([0, -1])).toBe('north');
    expect(compass([1, 0])).toBe('east');
    expect(compass([0, 1])).toBe('south');
    expect(compass([-1, 0])).toBe('west');
    expect(compass([1, -1])).toBe('north-east');
  });
});

describe('describePlanForLLM', () => {
  const text = describePlanForLLM(project, catalog);

  it('states the coordinate convention', () => {
    expect(text).toMatch(/x grows to the east.*y grows to the south.*north is up/);
  });

  it('lists walls with refs, compass sides, lengths, and corners', () => {
    expect(text).toContain('- w1: north wall, 3000 mm, from (0, 0) to (3000, 0), 100 mm thick');
    expect(text).toContain('- w2: east wall, 4000 mm, from (3000, 0) to (3000, 4000), 100 mm thick');
    expect(text).toContain('- w4: west wall, 4000 mm, from (0, 4000) to (0, 0), 100 mm thick');
  });

  it('lists openings with their centre along the wall', () => {
    expect(text).toContain('- o1: door on w4, 800 mm wide, centred 3200 mm along w4');
  });

  it('lists items with name, catalog id, size, centre, facing, and the wall they are against', () => {
    expect(text).toContain(
      '- i1: "Dishwasher (600 mm)" [dishwasher-600], 600 × 580 mm, centre (1250, 290), facing south, against w1 at 1250 mm'
    );
    expect(text).toContain('- i2: "Island (1200 × 900 mm)" [island-1200x900], 1200 × 900 mm, centre (1500, 2000), facing west');
    expect(text).not.toMatch(/i2.*against/);
  });

  it('adds the layout check failures, and leaves them out when nothing fails', () => {
    // A sink jammed against a wall with nothing beside it.
    const failing: Project = {
      ...project,
      items: [{ id: 's', catalogId: 'sink-base-900', tag: 'sink', sizeMm: { w: 900, d: 560, h: 870 }, position: { x: 450, y: 280 }, rotationDeg: 0 }],
    };
    expect(describePlanForLLM(failing, catalog)).toMatch(
      /Layout check failures[^\n]*:\n- Counter beside the sink: 0 mm and 0 mm beside "sink-base-900"/
    );
    // The fixture's items have no tags, so nothing is checked and nothing fails.
    expect(text).not.toContain('Layout check failures');
  });

  it('adds the accessibility failures, telling the model to act only if asked', () => {
    const narrowDoor: Project = {
      ...project,
      items: [{ id: 's', catalogId: 'sink-base-900', tag: 'sink', sizeMm: { w: 900, d: 560, h: 870 }, position: { x: 450, y: 280 }, rotationDeg: 0 }],
      room: { ...project.room, openings: [{ id: 'd1', wallId: project.room.walls[0].id, kind: 'door', positionMm: 100, widthMm: 700, heightMm: 2100 }] },
    };
    expect(describePlanForLLM(narrowDoor, catalog)).toMatch(
      /Accessibility check failures[^\n]*only fix if asked[^\n]*:\n- Door wide enough: widest door 700 mm \(needs 815 mm\)/
    );
    expect(describePlanForLLM({ ...narrowDoor, room: { ...narrowDoor.room, openings: [] } }, catalog)).not.toContain('Accessibility check failures');
  });

  it('says so when there are no items or openings', () => {
    const empty = describePlanForLLM({ ...project, items: [], room: { ...project.room, openings: [] } }, catalog);
    expect(empty).toMatch(/Openings:\n\(none\)/);
    expect(empty).toMatch(/Items[^\n]*:\n\(none\)/);
  });
});

describe('describeCatalogForLLM', () => {
  it('lists every item compactly with id, name, size, and mount', () => {
    const text = describeCatalogForLLM(catalog);
    expect(text.split('\n')).toHaveLength(catalog.items.length);
    expect(text).toContain('- dishwasher-600: Dishwasher (600 mm), 600 × 580 × 850 mm, floor');
    expect(text).toContain('- wall-600x320x720: Wall cabinet 600 mm, 600 × 320 × 720 mm, wall');
  });
});
