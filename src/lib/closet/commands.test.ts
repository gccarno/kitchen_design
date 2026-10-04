import { describe, it, expect } from 'vitest';
import { applyJsonPatch, commitRevision } from '../plan/diff';
import { undoRedo } from '../plan/history';
import { CommandError } from '../plan/commands';
import { ProjectSchema, type Project } from '../plan/schemas';
import { newCloset, newComponent } from './catalog';
import { ClosetCommandSchema, compileClosetCommands, withCloset } from './commands';

function closetProject(over: Partial<NonNullable<Project['closet']>> = {}): Project {
  const closet = { ...newCloset(), ...over };
  return ProjectSchema.parse({
    id: 'p1',
    name: 'Closet',
    kind: 'closet',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [closet.widthMm, 0],
        [closet.widthMm, closet.depthMm],
        [0, closet.depthMm],
      ],
      walls: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, thicknessMm: 100 })),
      openings: [],
    },
    items: [],
    closet,
    history: [],
  });
}

function ids() {
  let n = 0;
  return () => `new${++n}`;
}

describe('compileClosetCommands', () => {
  it('adds a component with catalog defaults and returns a patch that reproduces it', () => {
    const p = closetProject();
    const { project, patch } = compileClosetCommands(p, [{ type: 'addComponent', kind: 'drawers', xMm: 600 }], ids());
    expect(project.closet!.components).toEqual([newComponent('drawers', 'new1', 600)]);
    expect(applyJsonPatch(p, patch)).toEqual(project);
  });

  it('applies overrides and clamps a component into the closet', () => {
    const { project } = compileClosetCommands(
      closetProject(),
      [{ type: 'addComponent', kind: 'shelf', xMm: 1500, widthMm: 900, yMm: 2134 }],
      ids()
    );
    // 1500 + 900 would run past the 1830 side: it slides left to fit.
    expect(project.closet!.components[0]).toMatchObject({ xMm: 930, widthMm: 900, yMm: 2134 });
  });

  it('moves, resizes and removes components by ref', () => {
    const p = closetProject({ components: [newComponent('rod', 'a', 0), newComponent('drawers', 'b', 1000)] });
    const { project } = compileClosetCommands(
      p,
      [
        { type: 'moveComponent', component: 'c1', yMm: 2057 },
        { type: 'resizeComponent', component: 'c2', widthMm: 457, count: 5 },
        { type: 'removeComponent', component: 'c1' },
      ],
      ids()
    );
    expect(project.closet!.components).toEqual([{ ...newComponent('drawers', 'b', 1000), widthMm: 457, count: 5 }]);
  });

  it('resizes the closet, keeping a full-width opening full width and the footprint in step', () => {
    const { project } = compileClosetCommands(closetProject(), [{ type: 'setClosetSize', widthMm: 2400, depthMm: 650 }], ids());
    expect(project.closet).toMatchObject({ widthMm: 2400, heightMm: 2440, depthMm: 650 });
    expect(project.closet!.opening).toEqual({ style: 'bifold', leftMm: 0, widthMm: 2400 });
    expect(project.room.polygon).toEqual([
      [0, 0],
      [2400, 0],
      [2400, 650],
      [0, 650],
    ]);
  });

  it('sets the door opening', () => {
    const { project } = compileClosetCommands(
      closetProject(),
      [{ type: 'setOpening', style: 'sliding', leftMm: 115, widthMm: 1600 }],
      ids()
    );
    expect(project.closet!.opening).toEqual({ style: 'sliding', leftMm: 115, widthMm: 1600 });
  });

  it('renames the project', () => {
    expect(compileClosetCommands(closetProject(), [{ type: 'renameProject', name: 'Hall' }], ids()).project.name).toBe('Hall');
  });

  it('names an unknown ref, with the ones that exist', () => {
    const p = closetProject({ components: [newComponent('rod', 'a', 0)] });
    expect(() => compileClosetCommands(p, [{ type: 'removeComponent', component: 'c4' }], ids())).toThrow(
      new CommandError('commands[0] (removeComponent): unknown component "c4" — components are c1')
    );
  });

  it('stops at the first command that would make the closet invalid', () => {
    const p = closetProject({ components: [newComponent('shelf', 'a', 0)] });
    expect(() => compileClosetCommands(p, [{ type: 'setClosetSize', widthMm: 500 }], ids())).toThrow(
      /commands\[0\] \(setClosetSize\): the result would be invalid: Shelf c1 is outside the closet/
    );
  });

  it('refuses a project without a closet', () => {
    const kitchen = { ...closetProject(), kind: 'kitchen' as const, closet: undefined };
    expect(() => compileClosetCommands(kitchen, [], ids())).toThrow(CommandError);
  });

  it('parses the commands the LLM sends and rejects unknown component kinds', () => {
    expect(ClosetCommandSchema.safeParse({ type: 'addComponent', kind: 'rod', xMm: 0 }).success).toBe(true);
    expect(ClosetCommandSchema.safeParse({ type: 'addComponent', kind: 'sofa', xMm: 0 }).success).toBe(false);
  });

  it('round-trips through commit and undo', () => {
    const p = closetProject();
    const { patch } = compileClosetCommands(p, [{ type: 'addComponent', kind: 'tower', xMm: 0 }], ids());
    const at = '2026-01-02T00:00:00.000Z';
    const committed = commitRevision(p, patch, { baseRevision: 0, source: 'llm', summary: 'Add tower', at });
    expect(committed.closet!.components).toHaveLength(1);
    const undone = undoRedo(committed, 'undo', committed.revision, at);
    expect(undone.closet!.components).toEqual([]);
  });
});

describe('withCloset', () => {
  it('keeps the room outline as the closet footprint', () => {
    const p = closetProject();
    const next = withCloset(p, { ...p.closet!, widthMm: 1000, depthMm: 500 });
    expect(next.room.polygon).toEqual([
      [0, 0],
      [1000, 0],
      [1000, 500],
      [0, 500],
    ]);
    expect(next.room.walls).toBe(p.room.walls);
  });
});
