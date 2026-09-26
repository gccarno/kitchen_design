import { create } from 'zustand';
import type { Photo, Project } from '@/lib/plan/schemas';
import type { Proposal } from '@/lib/plan/proposal';

/**
 * Client-side state for the project editor: the project as last saved on
 * the server, and at most one proposal awaiting review. The server stays
 * the source of truth — the project here only changes when a save returns.
 */
interface EditorState {
  project: Project | null;
  proposal: Proposal | null;
  /** Start editing a project (clears any pending proposal). */
  load: (project: Project) => void;
  propose: (proposal: Proposal) => void;
  /** The server committed the proposal and returned the saved project. */
  applied: (project: Project) => void;
  discard: () => void;
  /** Photos are saved directly (not revisions), so they update in place. */
  setPhotos: (photos: Photo[]) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  project: null,
  proposal: null,
  load: (project) => set({ project, proposal: null }),
  propose: (proposal) => set({ proposal }),
  applied: (project) => set({ project, proposal: null }),
  discard: () => set({ proposal: null }),
  setPhotos: (photos) => set((s) => (s.project ? { project: { ...s.project, photos } } : s)),
}));
