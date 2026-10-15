import { randomUUID } from 'node:crypto';
import { closetFootprint, newCloset } from '../closet/catalog';
import { ProjectSchema, type Project, type ProjectKind } from './schemas';

/** A fresh, unsaved project: a kitchen with the default room, or a closet with the default closet. */
export function newProject(fields: { id?: string; name: string; kind?: ProjectKind }): Project {
  const now = new Date().toISOString();
  const kind = fields.kind ?? 'kitchen';
  const closet = kind === 'closet' ? newCloset() : undefined;
  return ProjectSchema.parse({
    id: fields.id ?? randomUUID(),
    name: fields.name,
    kind,
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: {
      // Kitchens start as a 3m × 4m rectangle so the editor has something to
      // draw on; the user replaces it once photos are extracted or the room
      // is sketched. A closet's room is just its footprint.
      polygon: closet
        ? closetFootprint(closet)
        : [
            [0, 0],
            [3000, 0],
            [3000, 4000],
            [0, 4000],
          ],
      walls: Array.from({ length: 4 }, () => ({ id: randomUUID(), thicknessMm: 100 })),
      openings: [],
    },
    items: [],
    ...(closet ? { closet } : {}),
    history: [],
  });
}
