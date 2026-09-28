import { describe, it, expect } from 'vitest';
import { proposalFromExtraction, proposalForPlan, proposalForRoom } from './proposal';
import { commitRevision } from './diff';
import { ProjectSchema, type Room } from './schemas';

const project = ProjectSchema.parse({
  id: 'p',
  name: 'K',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 4,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [],
  },
  items: [],
  history: [],
});

const room: Room = {
  polygon: [
    [0, 0],
    [2000, 0],
    [2000, 2000],
    [0, 2000],
  ],
  walls: ['w', 'x', 'y', 'z'].map((id) => ({ id, thicknessMm: 100 })),
  openings: [],
};

describe('proposalForRoom', () => {
  it('builds a user proposal whose patch commits to exactly that room', () => {
    const p = proposalForRoom(project, room, 'Sketched room');
    expect(p).toMatchObject({ baseRevision: 4, summary: 'Sketched room', source: 'user' });
    const next = commitRevision(project, p.patch, { baseRevision: p.baseRevision, source: p.source, summary: p.summary });
    expect(next.room).toEqual(room);
  });
});

describe('proposalForPlan', () => {
  it('can change just the items', () => {
    const items = [{ id: 'i', catalogId: 'c', sizeMm: { w: 600, d: 560, h: 720 }, position: { x: 1000, y: 1000 }, rotationDeg: 0 }];
    const p = proposalForPlan(project, { items }, 'Add c');
    expect(p.patch.every((op) => op.path.startsWith('/items'))).toBe(true);
    const next = commitRevision(project, p.patch, { baseRevision: 4, source: 'user', summary: p.summary });
    expect(next.items).toEqual(items);
    expect(next.room).toEqual(project.room);
  });
});

describe('proposalFromExtraction', () => {
  it('carries the model output into an llm proposal', () => {
    const p = proposalFromExtraction({
      patch: [{ op: 'replace', path: '/name', value: 'x' }],
      baseRevision: 4,
      confidence: 0.6,
      notes: 'n',
      warnings: ['w'],
    });
    expect(p).toEqual({
      patch: [{ op: 'replace', path: '/name', value: 'x' }],
      baseRevision: 4,
      summary: 'Room from photos',
      source: 'llm',
      confidence: 0.6,
      notes: 'n',
      warnings: ['w'],
    });
  });
});
