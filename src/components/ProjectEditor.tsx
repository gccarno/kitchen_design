'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CatalogSidebar from './CatalogSidebar';
import ChatPanel from './ChatPanel';
import DiffPreview from './DiffPreview';
import ExtractPanel from './ExtractPanel';
import PhotoCapture from './PhotoCapture';
import FloorPlanCanvas, { type PlanChange } from './FloorPlanCanvas';
import HistoryControls from './HistoryControls';
import RoomSketch from './RoomSketch';
import { polygonAreaMm2, polygonBounds, type Point } from '@/lib/plan/geometry';
import { proposalForPlan, proposalForRoom } from '@/lib/plan/proposal';
import { validatePlan } from '@/lib/plan/validate';
import type { CatalogItem } from '@/lib/catalog/schema';
import { loadCatalog } from '@/lib/catalog/loader';
import type { Project } from '@/lib/plan/schemas';
import { submitRevision } from '@/lib/client/revisions';
import { useEditorStore } from '@/store/editor';

/**
 * The project page's client side: photos, the current room, the two ways
 * to get a room (from photos, or sketched), and the review step that every
 * change goes through before it is saved.
 */
export default function ProjectEditor({ initialProject }: { initialProject: Project }) {
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

  // Bring each new proposal (from photos, chat, or the sketch) into view for review.
  useEffect(() => {
    if (proposal) reviewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [proposal]);
  const itemLabels = useMemo(
    () => Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId])),
    [project.items, catalog]
  );
  const warnings = useMemo(() => validatePlan(project).warnings, [project]);

  function pickFromCatalog(item: CatalogItem) {
    setPlacingItem((current) => (current?.id === item.id ? null : item));
    canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // Direct edits on the canvas are committed straight away (no review step)
  // as user revisions, so they land in history for undo.
  async function editPlan(change: PlanChange, summary: string): Promise<string | null> {
    const result = await submitRevision(project.id, proposalForPlan(project, change, summary));
    if (result.ok) {
      saved(result.project);
      return null;
    }
    return result.stale ? 'the plan changed in another tab — reload the page' : result.error;
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
        <p className="text-sm text-gray-500">Revision {project.revision}</p>
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
    </main>
  );
}
