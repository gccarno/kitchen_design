import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProjectEditor from '@/components/ProjectEditor';
import { isValidProjectId, loadProject, projectExists, resolveDataDir } from '@/lib/storage/projects';

// Always read the project from disk; it changes on every save.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function find(id: string) {
  const dataDir = resolveDataDir();
  if (!isValidProjectId(id) || !projectExists(dataDir, id)) return null;
  return loadProject(dataDir, id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = find((await params).id);
  return { title: project ? `${project.name} · Home Design` : 'Project not found' };
}

export default async function ProjectPage({ params }: Props) {
  const project = find((await params).id);
  if (!project) notFound();
  return <ProjectEditor initialProject={project} />;
}
