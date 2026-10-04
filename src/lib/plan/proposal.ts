import { withCloset } from '../closet/commands';
import { planToJsonPatch } from './diff';
import type { Closet, JsonPatchOp, PlacedItem, Project, Room } from './schemas';

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

/** Propose a user edit to the room and/or the placed items. */
export function proposalForPlan(
  project: Project,
  change: { room?: Room; items?: PlacedItem[] },
  summary: string
): Proposal {
  const next = { ...project, room: change.room ?? project.room, items: change.items ?? project.items };
  return { patch: planToJsonPatch(project, next), baseRevision: project.revision, summary, source: 'user' };
}

/** Propose a user edit to a closet project's closet (its footprint follows). */
export function proposalForCloset(project: Project, closet: Closet, summary: string): Proposal {
  return { patch: planToJsonPatch(project, withCloset(project, closet)), baseRevision: project.revision, summary, source: 'user' };
}

/** Propose replacing the project's room (e.g. from the manual sketch). */
export function proposalForRoom(project: Project, room: Room, summary: string): Proposal {
  return proposalForPlan(project, { room }, summary);
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

/** The fields of POST /api/projects/[id]/refine's response a proposal needs. */
export interface RefinementResponse {
  patch: JsonPatchOp[];
  baseRevision: number;
  summary: string;
  reply: string;
  warnings: string[];
}

export function proposalFromRefinement(r: RefinementResponse): Proposal {
  return {
    patch: r.patch,
    baseRevision: r.baseRevision,
    summary: r.summary || 'Chat edit',
    source: 'llm',
    ...(r.reply ? { notes: r.reply } : {}),
    warnings: r.warnings,
  };
}
