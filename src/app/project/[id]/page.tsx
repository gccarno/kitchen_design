import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProjectEditor from '@/components/ProjectEditor';
import { optionGroupId } from '@/lib/plan/options';
import { getPageStorage } from '@/lib/auth/page';
import { optionGroup } from '@/lib/storage';

// Always read the project from storage; it changes on every save.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function find(id: string) {
  return (await getPageStorage()).projects.load(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = await find((await params).id);
  return { title: project ? `${project.name} · Home Design` : 'Project not found' };
}

export default async function ProjectPage({ params }: Props) {
  const project = await find((await params).id);
  if (!project) notFound();
  const groupId = optionGroupId(project);
  const optionCount = (await optionGroup(await getPageStorage(), groupId)).length;
  return <ProjectEditor initialProject={project} groupId={groupId} optionCount={optionCount} />;
}
