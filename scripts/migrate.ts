/**
 * npm run db:migrate — apply migrations to DATABASE_URL by hand.
 * Refuses a non-local database unless MIGRATE_ALLOW_REMOTE=1: production is
 * migrated by the app at startup from committed migrations, never from a laptop.
 */
import { closeDb } from '../src/lib/db/client';
import { runMigrations } from '../src/lib/db/migrate';
import { isLocalDatabase } from '../src/lib/db/remote-guard';

// The package is CommonJS to tsx (no "type": "module"), so no top-level await.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!isLocalDatabase(url) && process.env.MIGRATE_ALLOW_REMOTE !== '1') {
    console.error('Refusing to migrate a non-local database. Set MIGRATE_ALLOW_REMOTE=1 if you really mean it.');
    process.exit(1);
  }
  try {
    await runMigrations();
    console.log('Migrations applied.');
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
