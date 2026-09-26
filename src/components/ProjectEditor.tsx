'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import DiffPreview from './DiffPreview';
import ExtractPanel from './ExtractPanel';
import PhotoCapture from './PhotoCapture';
import FloorPlanCanvas from './FloorPlanCanvas';
import RoomSketch from './RoomSketch';
import { polygonAreaMm2, polygonBounds, type Point } from '@/lib/plan/geometry';
import { proposalForRoom } from '@/lib/plan/proposal';
import type { Project } from '@/lib/plan/schemas';
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
  const { propose, applied, discard, setPhotos } = useEditorStore.getState();

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
        <DiffPreview
          projectId={project.id}
          current={project}
          proposal={proposal}
          onApplied={applied}
          onDiscard={discard}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Current room</h2>
        <FloorPlanCanvas room={project.room} items={project.items} units={project.units} label="Current room" />
        <p className="text-sm text-gray-600">
          {Math.round(bounds.maxX - bounds.minX)} × {Math.round(bounds.maxY - bounds.minY)} mm, {areaM2.toFixed(1)} m²
        </p>
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
