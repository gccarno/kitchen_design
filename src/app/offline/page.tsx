import Link from 'next/link';

export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="text-gray-600">Open a project you&apos;ve viewed before.</p>
      <Link href="/" className="underline">
        Go home
      </Link>
    </main>
  );
}
