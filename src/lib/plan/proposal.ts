import { planToJsonPatch } from './diff';
import type { JsonPatchOp, Project, Room } from './schemas';

/** A proposed edit awaiting the user's confirmation in the diff preview. */
export interface Proposal {
  patch: JsonPatchOp[];
  /** Revision the patch was computed against; the server rejects it if the plan has moved on. */
  baseRevision: number;
  summary: string;
  source: 'user' | 'llm';
  /** LLM proposals only. */
  confidence?: number;
  notes?: string;
  warnings?: string[];
}

/** Propose replacing the project's room (e.g. from the manual sketch). */
export function proposalForRoom(project: Project, room: Room, summary: string): Proposal {
  return {
    patch: planToJsonPatch(project, { ...project, room }),
    baseRevision: project.revision,
    summary,
    source: 'user',
  };
}

/** The fields of POST /api/projects/[id]/extract's response a proposal needs. */
export interface ExtractionResponse {
  patch: JsonPatchOp[];
  baseRevision: number;
  confidence: number;
  notes: string;
  warnings: string[];
}

export function proposalFromExtraction(r: ExtractionResponse): Proposal {
  return {
    patch: r.patch,
    baseRevision: r.baseRevision,
    summary: 'Room from photos',
    source: 'llm',
    confidence: r.confidence,
    notes: r.notes,
    warnings: r.warnings,
  };
}
