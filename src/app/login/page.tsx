import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { authEnabled, registrationAllowed } from '@/lib/auth/config';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (!authEnabled()) redirect('/');
  const { next } = await searchParams;
  const canRegister = await registrationAllowed(getDb());
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 p-4 sm:p-8">
      <LoginForm next={typeof next === 'string' ? next : undefined} canRegister={canRegister} />
    </main>
  );
}
