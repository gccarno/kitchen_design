import { describe, it, expect } from 'vitest';
import { commitRevision, HISTORY_LIMIT, StaleRevisionError } from './diff';
import { changeSummary, NothingToUndoError, undoRedo, undoRedoState } from './history';
import { ProjectSchema, type PlacedItem, type Project } from './schemas';

const at = '2026-01-01T00:00:00.000Z';

function newProject(): Project {
  return ProjectSchema.parse({
    id: 'p1',
    name: 'Start',
    units: 'mm',
    createdAt: at,
    updatedAt: at,
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
      openings: [],
    },
    items: [],
    history: [],
  });
}

const rename = (p: Project, name: string) =>
  commitRevision(p, [{ op: 'replace', path: '/name', value: name }], { baseRevision: p.revision, source: 'user', summary: `rename to ${name}`, at });
const undo = (p: Project) => undoRedo(p, 'undo', p.revision, at);
const redo = (p: Project) => undoRedo(p, 'redo', p.revision, at);

describe('undo/redo', () => {
  it('has nothing to undo or redo on a new project', () => {
    expect(undoRedoState([])).toEqual({ undo: null, redo: null });
    expect(() => undo(newProject())).toThrow(NothingToUndoError);
    expect(() => redo(newProject())).toThrow(/nothing to redo/);
  });

  it('undoes the last change as a new revision, then redoes it', () => {
    const edited = rename(rename(newProject(), 'One'), 'Two');
    const undone = undo(edited);
    expect(undone.name).toBe('One');
    expect(undone.revision).toBe(3);
    expect(undone.history.at(-1)).toMatchObject({ summary: 'Undo: rename to Two', undoes: 2, source: 'user' });
    expect(undoRedoState(undone.history).redo?.revision).toBe(3);

    const redone = redo(undone);
    expect(redone.name).toBe('Two');
    expect(redone.history.at(-1)).toMatchObject({ summary: 'Redo: rename to Two', redoes: 3 });
    expect(undoRedoState(redone.history).redo).toBeNull();
  });

  it('walks back through several changes and forward again', () => {
    let p = rename(rename(rename(newProject(), 'A'), 'B'), 'C');
    p = undo(undo(undo(p)));
    expect(p.name).toBe('Start');
    expect(() => undo(p)).toThrow(NothingToUndoError);
    p = redo(redo(p));
    expect(p.name).toBe('B');
    expect(changeSummary(undoRedoState(p.history).redo!)).toBe('rename to C');
    expect(changeSummary(undoRedoState(p.history).undo!)).toBe('rename to B');
  });

  it('undoes a redo', () => {
    const p = undo(redo(undo(rename(newProject(), 'A'))));
    expect(p.name).toBe('Start');
    expect(redo(p).name).toBe('A');
  });

  it('a new change after an undo clears redo', () => {
    const p = rename(undo(rename(newProject(), 'A')), 'B');
    expect(undoRedoState(p.history).redo).toBeNull();
    expect(undo(p).name).toBe('Start');
  });

  it('restores removed items exactly', () => {
    const item: PlacedItem = { id: 'i', catalogId: 'dishwasher-600', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 300, y: 290 }, rotationDeg: 0 };
    const added = commitRevision(newProject(), [{ op: 'add', path: '/items/0', value: item }], { baseRevision: 0, source: 'llm', summary: 'add', at });
    const removed = commitRevision(added, [{ op: 'remove', path: '/items/0' }], { baseRevision: 1, source: 'user', summary: 'remove', at });
    expect(undo(removed).items).toEqual([item]);
    expect(undo(undo(removed)).items).toEqual([]);
  });

  it('refuses a stale base revision', () => {
    const p = rename(newProject(), 'A');
    expect(() => undoRedo(p, 'undo', 0, at)).toThrow(StaleRevisionError);
  });

  it('still works when the oldest history has been dropped', () => {
    let p = newProject();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = rename(p, `n${i}`);
    expect(p.history).toHaveLength(HISTORY_LIMIT);
    p = undo(p);
    expect(p.name).toBe(`n${HISTORY_LIMIT + 3}`);
  });
});
