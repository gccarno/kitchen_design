import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CompareOptions from '@/components/CompareOptions';
import { loadCatalog } from '@/lib/catalog/loader';
import { groupName } from '@/lib/plan/options';
import { optionGroup, resolveDataDir } from '@/lib/storage/projects';

// Always read the projects from disk; they change on every save.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ groupId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const group = optionGroup(resolveDataDir(), (await params).groupId);
  return { title: group.length > 0 ? `Compare options — ${groupName(group)} · Home Design` : 'Options not found' };
}

export default async function ComparePage({ params }: Props) {
  const group = optionGroup(resolveDataDir(), (await params).groupId);
  if (group.length === 0) notFound();
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-8">
      <Link href="/" className="text-sm text-gray-600 underline">
        All projects
      </Link>
      <CompareOptions projects={group} catalog={loadCatalog()} />
    </main>
  );
}
