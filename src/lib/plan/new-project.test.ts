import { describe, it, expect } from 'vitest';
import { newProject } from './new-project';
import { ProjectSchema } from './schemas';

describe('newProject', () => {
  it('makes a valid kitchen with a 3 m × 4 m room, four walls and revision 0', () => {
    const p = newProject({ name: 'Kitchen' });
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(p).toMatchObject({ name: 'Kitchen', kind: 'kitchen', units: 'mm', revision: 0, photos: [], items: [], history: [] });
    expect(p.room.polygon).toEqual([[0, 0], [3000, 0], [3000, 4000], [0, 4000]]);
    expect(p.room.walls).toHaveLength(4);
    expect(p.createdAt).toBe(p.updatedAt);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('makes a closet whose room is the closet footprint', () => {
    const p = newProject({ name: 'Hall closet', kind: 'closet' });
    expect(p.kind).toBe('closet');
    expect(p.closet).toBeTruthy();
  });

  it('keeps a given id', () => {
    const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
    expect(newProject({ id, name: 'X' }).id).toBe(id);
  });
});
