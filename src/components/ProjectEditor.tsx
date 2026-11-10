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
import FinishesPanel from './FinishesPanel';
import LayoutCheckPanel from './LayoutCheckPanel';
import RoomSketch from './RoomSketch';
import StepTabs, { stepPanelId, stepTabId, type Step } from './StepTabs';
import { polygonAreaMm2, polygonBounds, type Point } from '@/lib/plan/geometry';
import {
  proposalForFinishes,
  proposalForPlan,
  proposalForPricing,
  proposalForRoom,
  proposalForUnits,
  type Proposal,
} from '@/lib/plan/proposal';
import { checkAccessibility, checkLayout } from '@/lib/plan/layout-check';
import { isNative } from '@/lib/client/native';
import { saveAndShare } from '@/lib/client/download';
import { wallElevations } from '@/lib/plan/elevation';
import { validatePlan } from '@/lib/plan/validate';
import { formatLength } from '@/lib/plan/viewport';
import type { CatalogItem } from '@/lib/catalog/schema';
import { loadCatalog } from '@/lib/catalog/loader';
import type { Finishes, Pricing, Project } from '@/lib/plan/schemas';
import { useOnline } from '@/lib/client/online';
import { STALE_EVENT, submitRevision } from '@/lib/client/revisions';
import { useEditorStore } from '@/store/editor';

/**
 * The project page's client side. A kitchen: the plan stays in view while a
 * four-step panel (room, layout, finishes and cost, share) works on it. A
 * closet: its front elevation (`ClosetEditor`). Both: the review step that
 * proposed changes go through before they are saved.
 */
interface ProjectEditorProps {
  initialProject: Project;
  /** How many projects share this one's option group (from the server); the compare link needs two. */
  optionCount?: number;
  /** The option group's id (from the server). */
  groupId?: string;
}

const STEPS = [
  { id: 'room', label: 'Room' },
  { id: 'layout', label: 'Layout' },
  { id: 'finishes', label: 'Finishes & cost' },
  { id: 'share', label: 'Share' },
] as const satisfies ReadonlyArray<Step>;
type StepId = (typeof STEPS)[number]['id'];
const isStepId = (v: unknown): v is StepId => STEPS.some((s) => s.id === v);
const STEP_PREFIX = 'kitchen';

/** A project nobody has worked on starts at the room; one with work in it, at the layout. */
function defaultStep(project: Project): StepId {
  return project.revision === 0 && project.items.length === 0 ? 'room' : 'layout';
}

const M2_TO_FT2 = 10.7639;

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
  const online = useOnline();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);

  // The step is remembered for this tab, so a refresh (or a save's reload) stays where you were.
  const stepKey = `kd-step:${initialProject.id}`;
  const [step, setStep] = useState<StepId>(() => defaultStep(initialProject));
  useEffect(() => {
    try {
      const remembered = sessionStorage.getItem(stepKey);
      if (isStepId(remembered)) setStep(remembered);
    } catch {
      /* storage blocked: keep the default */
    }
  }, [stepKey]);
  function chooseStep(next: StepId) {
    setStep(next);
    try {
      sessionStorage.setItem(stepKey, next);
    } catch {
      /* storage blocked: the step just isn't remembered */
    }
  }

  // A save was rejected because the project changed elsewhere: reload the latest version from the server.
  useEffect(() => {
    const onStale = (e: Event) => {
      if ((e as CustomEvent<{ projectId?: string }>).detail?.projectId === initialProject.id) router.refresh();
    };
    window.addEventListener(STALE_EVENT, onStale);
    return () => window.removeEventListener(STALE_EVENT, onStale);
  }, [router, initialProject.id]);

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
  const access = useMemo(() => checkAccessibility(project), [project]);
  const elevations = useMemo(() => (project.closet ? [] : wallElevations(project, catalog)), [project, catalog]);

  function pickFromCatalog(item: CatalogItem) {
    setPlacingItem((current) => (current?.id === item.id ? null : item));
    canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  // Direct edits (the canvas, prices, finishes, units) are committed straight
  // away, with no review step, as user revisions, so they land in history for undo.
  // Resolves to an error message, or null when saved (or there was nothing to save).
  async function commit(proposal: Proposal): Promise<string | null> {
    // E.g. a drag that snapped back to where it started: nothing to save.
    if (proposal.patch.length === 0) return null;
    const result = await submitRevision(project.id, proposal);
    if (result.ok) {
      saved(result.project);
      return null;
    }
    return result.error;
  }
  const OFFLINE = 'offline — editing is disabled';
  const editPlan = async (change: PlanChange, summary: string) =>
    online ? commit(proposalForPlan(project, change, summary)) : OFFLINE;
  const savePricing = async (pricing: Pricing | undefined, summary: string) =>
    online ? commit(proposalForPricing(project, pricing, summary)) : OFFLINE;
  const saveFinishes = async (finishes: Finishes | undefined, summary: string) =>
    online ? commit(proposalForFinishes(project, finishes, summary)) : OFFLINE;

  async function changeUnits(units: Project['units']) {
    setUnitsError(null);
    const summary = units === 'in' ? 'Show lengths in feet and inches' : 'Show lengths in millimetres';
    const error = online ? await commit(proposalForUnits(project, units, summary)) : OFFLINE;
    if (error) setUnitsError(error);
  }

  // Copy the design as a new option and open the copy. The button stays
  // disabled until the page changes, so a double click makes one copy.
  async function duplicate() {
    if (duplicating || !online) return;
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

  // Make suggested layouts as new options and open their comparison. The
  // project itself is untouched; with no layout to offer, say why.
  async function suggestLayouts() {
    if (suggesting || !online) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/propose-layouts`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { groupId?: string; options?: unknown[]; reason?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `could not suggest layouts (${res.status})`);
      if (!body.options?.length || !body.groupId) {
        setSuggestNote(body.reason ?? 'No layouts to suggest for this room.');
        setSuggesting(false);
        return;
      }
      router.push(`/compare/${body.groupId}`);
    } catch (err) {
      setSuggestError((err as Error).message);
      setSuggesting(false);
    }
  }

  const bounds = polygonBounds(project.room.polygon as Point[]);
  const areaM2 = polygonAreaMm2(project.room.polygon as Point[]) / 1e6;
  const roomSize =
    project.units === 'in'
      ? `${formatLength(bounds.maxX - bounds.minX, 'in')} × ${formatLength(bounds.maxY - bounds.minY, 'in')}, ${Math.round(areaM2 * M2_TO_FT2)} ft²`
      : `${Math.round(bounds.maxX - bounds.minX)} × ${Math.round(bounds.maxY - bounds.minY)} mm, ${areaM2.toFixed(1)} m²`;

  /** The downloads and the option buttons: in the header for a closet, in the Share step for a kitchen. */
  const shareControls = (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* The revision in the URL makes each export fresh after an edit. */}
        <span className="text-gray-500">Download drawing:</span>
        <ExportLink online={online} href={`/api/export/${project.id}/svg?rev=${project.revision}`}>
          SVG
        </ExportLink>
        <ExportLink online={online} href={`/api/export/${project.id}/png?scale=1&rev=${project.revision}`}>
          PNG
        </ExportLink>
        <ExportLink online={online} href={`/api/export/${project.id}/png?scale=2&rev=${project.revision}`}>
          PNG (2×)
        </ExportLink>
        <span className="text-gray-500">Parts list:</span>
        <ExportLink online={online} href={`/api/export/${project.id}/csv?rev=${project.revision}`}>
          CSV
        </ExportLink>
        <ExportLink online={online} href={`/api/export/${project.id}/pdf?rev=${project.revision}`}>
          Spec sheet (PDF)
        </ExportLink>
        {elevations.length > 0 && (
          <>
            <span className="text-gray-500">Elevations:</span>
            <ExportLink aria-label="Elevations as SVG" online={online} href={`/api/export/${project.id}/elevations/svg?rev=${project.revision}`}>
              SVG
            </ExportLink>
            <ExportLink aria-label="Elevations as PNG" online={online} href={`/api/export/${project.id}/elevations/png?scale=1&rev=${project.revision}`}>
              PNG
            </ExportLink>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className="rounded border px-3 py-1 disabled:opacity-40"
          disabled={!online || duplicating}
          title={online ? undefined : 'Offline'}
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
    </>
  );

  const reviewPanel = proposal && (
    <div ref={reviewRef} className="scroll-mt-4">
      <DiffPreview
        projectId={project.id}
        current={project}
        proposal={proposal}
        onApplied={applied}
        onDiscard={discard}
      />
    </div>
  );

  if (project.closet) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
        <header className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-gray-600 underline">
            All projects
          </Link>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-500">Revision {project.revision}</span>
          </div>
          {shareControls}
        </header>
        {reviewPanel}
        <ClosetEditor
          project={{ ...project, closet: project.closet }}
          onSaved={saved}
          onProposal={propose}
          estimate={<EstimatePanel project={project} onSave={savePricing} />}
          accessibility={<LayoutCheckPanel rules={access} units={project.units} title="Accessibility" empty="add a rod or shelves to start" />}
        />
      </main>
    );
  }

  const nextButton = (to: StepId, label: string) => (
    <button type="button" className="self-start rounded border px-4 py-2 text-sm" onClick={() => chooseStep(to)}>
      Next: {label} →
    </button>
  );
  const panel = (id: StepId, children: React.ReactNode) => (
    <div
      role="tabpanel"
      id={stepPanelId(STEP_PREFIX, id)}
      aria-labelledby={stepTabId(STEP_PREFIX, id)}
      hidden={step !== id}
      // `flex` would override the hidden attribute's display:none, so an inactive panel gets the `hidden` class instead.
      className={`${step === id ? 'flex' : 'hidden'} flex-col gap-6 pt-4`}
    >
      {children}
    </div>
  );

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-gray-600 underline">
          All projects
        </Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500">Revision {project.revision}</span>
          <label className="flex items-center gap-2">
            <span className="text-gray-500">Units</span>
            <select
              className="rounded border px-2 py-0.5 disabled:opacity-40"
              value={project.units}
              disabled={!online}
              onChange={(e) => void changeUnits(e.target.value === 'in' ? 'in' : 'mm')}
            >
              <option value="mm">Millimetres</option>
              <option value="in">Feet and inches</option>
            </select>
          </label>
        </div>
        {unitsError && (
          <p role="alert" className="text-sm text-red-700">
            Couldn’t change units: {unitsError}
          </p>
        )}
      </header>

      {reviewPanel}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section ref={canvasRef} className="flex scroll-mt-4 flex-col gap-2 lg:sticky lg:top-4">
          <h2 className="text-lg font-semibold">Current room</h2>
          <HistoryControls project={project} onSaved={saved} />
          <FloorPlanCanvas
            room={project.room}
            items={project.items}
            units={project.units}
            label="Current room"
            onEdit={online ? editPlan : undefined}
            placingItem={placingItem}
            onPlacingDone={() => setPlacingItem(null)}
            itemLabels={itemLabels}
          />
          <p className="text-sm text-gray-600">{roomSize}</p>
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

        <div className="flex min-w-0 flex-col">
          <StepTabs steps={STEPS} active={step} onChange={chooseStep} idPrefix={STEP_PREFIX} />

          {panel(
            'room',
            <>
              <p className="text-sm text-gray-600">
                Get the room in first: add photos, or sketch it. Doors, windows and corners are edited right on the plan.
              </p>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Photos</h2>
                <PhotoCapture projectId={project.id} initialPhotos={project.photos} onPhotosChange={setPhotos} />
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Room from photos</h2>
                <ExtractPanel
                  projectId={project.id}
                  hasPhotos={project.photos.length > 0}
                  units={project.units}
                  onProposal={propose}
                />
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Or sketch it by hand</h2>
                <RoomSketch units={project.units} onSave={(room) => propose(proposalForRoom(project, room, 'Sketched room'))} />
              </section>
              {nextButton('layout', 'Layout')}
            </>
          )}

          {panel(
            'layout',
            <>
              <section className="flex flex-col gap-2 rounded border bg-gray-50 p-3">
                <h2 className="text-lg font-semibold">Suggest layouts</h2>
                <p className="text-sm text-gray-600">
                  Get up to three layouts for this room, each checked against the guidelines, to compare side by side. Your own design is left as it is.
                </p>
                <button
                  type="button"
                  className="self-start rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
                  disabled={!online || suggesting}
                  title={online ? 'Make up to three layouts for this room as new options' : 'Offline'}
                  onClick={() => void suggestLayouts()}
                >
                  {suggesting ? 'Suggesting…' : 'Suggest layouts'}
                </button>
                {suggestError && (
                  <p role="alert" className="text-sm text-red-700">
                    Couldn’t suggest layouts: {suggestError}
                  </p>
                )}
                {suggestNote && <p className="text-sm text-gray-700">{suggestNote}</p>}
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
                <h2 className="text-lg font-semibold">Ask for changes</h2>
                <ChatPanel projectId={project.id} onProposal={propose} />
              </section>
              <section className="flex flex-col gap-3">
                <LayoutCheckPanel rules={layout} units={project.units} />
                <LayoutCheckPanel rules={access} units={project.units} title="Accessibility" empty="place cabinets to start" />
              </section>
              {nextButton('finishes', 'Finishes & cost')}
            </>
          )}

          {panel(
            'finishes',
            <>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Finishes</h2>
                <FinishesPanel project={project} onSave={saveFinishes} />
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Wall elevations</h2>
                <KitchenElevations elevations={elevations} units={project.units} finishes={project.finishes} />
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Estimate</h2>
                <EstimatePanel project={project} onSave={savePricing} />
              </section>
              {nextButton('share', 'Share')}
            </>
          )}

          {panel(
            'share',
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Share and export</h2>
              {shareControls}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/** A server-generated download: a link online, a disabled label offline (it can't be fetched without a network). */
function ExportLink({ online, href, children, ...rest }: { online: boolean; href: string; children: React.ReactNode; 'aria-label'?: string }) {
  if (!online) {
    return (
      <span className="text-gray-400" title="Offline" aria-disabled="true" {...rest}>
        {children}
      </span>
    );
  }
  return (
    <a
      className="text-blue-700 underline"
      href={href}
      download
      onClick={async (e) => {
        if (!isNative()) return;
        e.preventDefault();
        try {
          await saveAndShare(href, href.split('?')[0].split('/').slice(-2).join('-'));
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Download failed.');
        }
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
