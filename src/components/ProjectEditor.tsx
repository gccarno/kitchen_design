'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CatalogSidebar from './CatalogSidebar';
import ChatPanel from './ChatPanel';
import ClosetEditor from './ClosetEditor';
import DiffPreview from './DiffPreview';
import EstimatePanel from './EstimatePanel';
import ExtractPanel from './ExtractPanel';
import PhotoCapture from './PhotoCapture';
import FloorPlanCanvas, { type PlanChange } from './FloorPlanCanvas';
import HistoryControls from './HistoryControls';
import KitchenElevations from './KitchenElevations';
import LayoutCheckPanel from './LayoutCheckPanel';
import RoomSketch from './RoomSketch';
import { polygonAreaMm2, polygonBounds, type Point } from '@/lib/plan/geometry';
import { proposalForPlan, proposalForPricing, proposalForRoom } from '@/lib/plan/proposal';
import { checkLayout } from '@/lib/plan/layout-check';
import { wallElevations } from '@/lib/plan/elevation';
import { validatePlan } from '@/lib/plan/validate';
import type { CatalogItem } from '@/lib/catalog/schema';
import { loadCatalog } from '@/lib/catalog/loader';
import type { Pricing, Project } from '@/lib/plan/schemas';
import { submitRevision } from '@/lib/client/revisions';
import { useEditorStore } from '@/store/editor';

/**
 * The project page's client side. A kitchen: photos, the current room, the
 * two ways to get a room (from photos, or sketched). A closet: its front
 * elevation (`ClosetEditor`). Both: export links, and the review step that
 * proposed changes go through before they are saved.
 */
interface ProjectEditorProps {
  initialProject: Project;
  /** How many projects share this one's option group (from the server); the compare link needs two. */
  optionCount?: number;
  /** The option group's id (from the server). */
  groupId?: string;
}

export default function ProjectEditor({ initialProject, optionCount, groupId }: ProjectEditorProps) {
  const load = useEditorStore((s) => s.load);
  useEffect(() => load(initialProject), [load, initialProject]);

  // Until the store has this project (first render), show what the server sent.
  const stored = useEditorStore((s) => s.project);
  const project = stored?.id === initialProject.id ? stored : initialProject;
  const proposal = useEditorStore((s) => s.proposal);
  const { propose, applied, discard, saved, setPhotos } = useEditorStore.getState();

  const catalog = loadCatalog();
  const [placingItem, setPlacingItem] = useState<CatalogItem | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  // Bring each new proposal (from photos, chat, or the sketch) into view for review.
  useEffect(() => {
    if (proposal) reviewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [proposal]);
  const itemLabels = useMemo(
    () => Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId])),
    [project.items, catalog]
  );
  const warnings = useMemo(() => validatePlan(project).warnings, [project]);
  const layout = useMemo(() => checkLayout(project), [project]);
  const elevations = useMemo(() => (project.closet ? [] : wallElevations(project, catalog)), [project, catalog]);

  function pickFromCatalog(item: CatalogItem) {
    setPlacingItem((current) => (current?.id === item.id ? null : item));
    canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // Direct edits on the canvas are committed straight away (no review step)
  // as user revisions, so they land in history for undo.
  async function editPlan(change: PlanChange, summary: string): Promise<string | null> {
    const proposal = proposalForPlan(project, change, summary);
    // E.g. a drag that snapped back to where it started: nothing to save.
    if (proposal.patch.length === 0) return null;
    const result = await submitRevision(project.id, proposal);
    if (result.ok) {
      saved(result.project);
      return null;
    }
    return result.stale ? 'the plan changed in another tab — reload the page' : result.error;
  }

  // Price edits save straight away too, the same way.
  async function savePricing(pricing: Pricing | undefined, summary: string): Promise<string | null> {
    const proposal = proposalForPricing(project, pricing, summary);
    if (proposal.patch.length === 0) return null;
    const result = await submitRevision(project.id, proposal);
    if (result.ok) {
      saved(result.project);
      return null;
    }
    return result.stale ? 'the plan changed in another tab — reload the page' : result.error;
  }

  // Copy the design as a new option and open the copy. The button stays
  // disabled until the page changes, so a double click makes one copy.
  async function duplicate() {
    if (duplicating) return;
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/duplicate`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
      if (!res.ok || !body.project) throw new Error(body.error ?? `could not duplicate (${res.status})`);
      router.push(`/project/${body.project.id}`);
    } catch (err) {
      setDuplicateError((err as Error).message);
      setDuplicating(false);
    }
  }

  const bounds = polygonBounds(project.room.polygon as Point[]);
  const areaM2 = polygonAreaMm2(project.room.polygon as Point[]) / 1e6;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-gray-600 underline">
          All projects
        </Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500">Revision {project.revision}</span>
          {/* The revision in the URL makes each export fresh after an edit. */}
          <span className="text-gray-500">Download drawing:</span>
          <a className="text-blue-700 underline" href={`/api/export/${project.id}/svg?rev=${project.revision}`} download>
            SVG
          </a>
          <a className="text-blue-700 underline" href={`/api/export/${project.id}/png?scale=1&rev=${project.revision}`} download>
            PNG
          </a>
          <a className="text-blue-700 underline" href={`/api/export/${project.id}/png?scale=2&rev=${project.revision}`} download>
            PNG (2×)
          </a>
          <span className="text-gray-500">Parts list:</span>
          <a className="text-blue-700 underline" href={`/api/export/${project.id}/csv?rev=${project.revision}`} download>
            CSV
          </a>
          {elevations.length > 0 && (
            <>
              <span className="text-gray-500">Elevations:</span>
              <a className="text-blue-700 underline" aria-label="Elevations as SVG" href={`/api/export/${project.id}/elevations/svg?rev=${project.revision}`} download>
                SVG
              </a>
              <a className="text-blue-700 underline" aria-label="Elevations as PNG" href={`/api/export/${project.id}/elevations/png?scale=1&rev=${project.revision}`} download>
                PNG
              </a>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-40"
            disabled={duplicating}
            onClick={() => void duplicate()}
          >
            Duplicate as option
          </button>
          {groupId && (optionCount ?? 0) >= 2 && (
            <Link className="text-blue-700 underline" href={`/compare/${groupId}`}>
              Compare options
            </Link>
          )}
        </div>
        {duplicateError && (
          <p role="alert" className="text-sm text-red-700">
            Couldn’t duplicate: {duplicateError}
          </p>
        )}
      </header>

      {proposal && (
        <div ref={reviewRef} className="scroll-mt-4">
          <DiffPreview
            projectId={project.id}
            current={project}
            proposal={proposal}
            onApplied={applied}
            onDiscard={discard}
          />
        </div>
      )}

      {project.closet ? (
        <ClosetEditor
          project={{ ...project, closet: project.closet }}
          onSaved={saved}
          onProposal={propose}
          estimate={<EstimatePanel project={project} onSave={savePricing} />}
        />
      ) : (
        <>
          <section ref={canvasRef} className="flex scroll-mt-4 flex-col gap-2">
            <h2 className="text-lg font-semibold">Current room</h2>
            <HistoryControls project={project} onSaved={saved} />
            <FloorPlanCanvas
              room={project.room}
              items={project.items}
              units={project.units}
              label="Current room"
              onEdit={editPlan}
              placingItem={placingItem}
              onPlacingDone={() => setPlacingItem(null)}
              itemLabels={itemLabels}
            />
            <p className="text-sm text-gray-600">
              {Math.round(bounds.maxX - bounds.minX)} × {Math.round(bounds.maxY - bounds.minY)} mm, {areaM2.toFixed(1)} m²
            </p>
            {warnings.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                <p className="font-medium">Heads up</p>
                <ul aria-label="Plan warnings" className="list-disc pl-5">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <LayoutCheckPanel rules={layout} units={project.units} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Wall elevations</h2>
            <KitchenElevations elevations={elevations} units={project.units} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Ask for changes</h2>
            <ChatPanel projectId={project.id} onProposal={propose} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Catalog</h2>
            <p className="text-sm text-gray-600">Pick an item, then tap the plan to place it.</p>
            <CatalogSidebar
              items={catalog.items}
              units={project.units}
              onPick={pickFromCatalog}
              selectedId={placingItem?.id ?? null}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Estimate</h2>
            <EstimatePanel project={project} onSave={savePricing} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Photos</h2>
            <PhotoCapture projectId={project.id} initialPhotos={project.photos} onPhotosChange={setPhotos} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Room from photos</h2>
            <ExtractPanel projectId={project.id} hasPhotos={project.photos.length > 0} onProposal={propose} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Or sketch it by hand</h2>
            <RoomSketch onSave={(room) => propose(proposalForRoom(project, room, 'Sketched room'))} />
          </section>
        </>
      )}
    </main>
  );
}
