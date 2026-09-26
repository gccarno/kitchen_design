import Link from 'next/link';
import NewProjectForm from '@/components/NewProjectForm';
import { listProjects, resolveDataDir } from '@/lib/storage/projects';

// The list reads the data directory on every request.
export const dynamic = 'force-dynamic';

export default function Home() {
  const projects = listProjects(resolveDataDir());
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">Kitchen Design</h1>
        <p className="text-gray-600">Photos and a tape measure in, an editable floor plan out.</p>
      </header>

      <NewProjectForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-600">No projects yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded border">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/project/${p.id}`} className="flex justify-between gap-4 p-3 hover:bg-gray-50">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm text-gray-500">
                    revision {p.revision} · {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
