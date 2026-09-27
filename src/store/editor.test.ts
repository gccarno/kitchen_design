import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editor';
import { ProjectSchema } from '@/lib/plan/schemas';

const project = ProjectSchema.parse({
  id: 'p',
  name: 'K',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 0,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    walls: ['a', 'b', 'c'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [],
  },
  items: [],
  history: [],
});
const proposal = { patch: [], baseRevision: 0, summary: 's', source: 'user' as const };

describe('editor store', () => {
  beforeEach(() => useEditorStore.getState().load(project));

  it('load() sets the project and clears any pending proposal', () => {
    useEditorStore.getState().propose(proposal);
    useEditorStore.getState().load({ ...project, name: 'Other' });
    expect(useEditorStore.getState().project?.name).toBe('Other');
    expect(useEditorStore.getState().proposal).toBeNull();
  });

  it('applied() replaces the project and clears the proposal', () => {
    useEditorStore.getState().propose(proposal);
    useEditorStore.getState().applied({ ...project, revision: 1 });
    expect(useEditorStore.getState().project?.revision).toBe(1);
    expect(useEditorStore.getState().proposal).toBeNull();
  });

  it('discard() clears the proposal and keeps the project', () => {
    useEditorStore.getState().propose(proposal);
    useEditorStore.getState().discard();
    expect(useEditorStore.getState().proposal).toBeNull();
    expect(useEditorStore.getState().project).toEqual(project);
  });

  it('setPhotos() updates photos without touching the revision', () => {
    const photos = [{ id: 'ph', path: 'photos/ph.jpg', width: 10, height: 10 }];
    useEditorStore.getState().setPhotos(photos);
    expect(useEditorStore.getState().project?.photos).toEqual(photos);
    expect(useEditorStore.getState().project?.revision).toBe(0);
  });

  it('saved() replaces the project but keeps a pending proposal', () => {
    useEditorStore.getState().propose(proposal);
    useEditorStore.getState().saved({ ...project, revision: 1 });
    expect(useEditorStore.getState().project?.revision).toBe(1);
    expect(useEditorStore.getState().proposal).toEqual(proposal);
  });
});
