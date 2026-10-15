import NewProjectForm from '@/components/NewProjectForm';
import ProjectList from '@/components/ProjectList';
import SignOutButton from '@/components/SignOutButton';
import { getPageStorage } from '@/lib/auth/page';
import { currentUser } from '@/lib/auth/session';

// The list reads storage on every request.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const projects = await (await getPageStorage()).projects.list();
  const user = await currentUser(); // null when auth is off
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold">Home Design</h1>
          {user && <SignOutButton email={user.email} />}
        </div>
        <p className="text-gray-600">Kitchens: photos and a tape measure in, an editable floor plan out. Closets: lay out rods, shelves and drawers on a front view.</p>
      </header>

      <NewProjectForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-600">No projects yet.</p>
        ) : (
          <ProjectList projects={projects} />
        )}
      </section>
    </main>
  );
}
